---
title: Python 异常处理
date: 2026-09-23 21:27:53
tags:
  - Python
categories:
  - 开发日记
excerpt: 系统梳理 Python 异常类继承、except 匹配与调用栈传播机制，说明异常转换、异常链、安全错误信息及分层处理的实践原则。
---

# Python异常处理笔记

## 一、异常类是一棵树

Python 的异常类型之间是继承关系，构成一棵树：

```text
BaseException
├── SystemExit
├── KeyboardInterrupt
├── GeneratorExit
└── Exception
    ├── ValueError
    │   └── json.JSONDecodeError
    ├── TypeError
    ├── KeyError
    ├── AttributeError
    ├── OSError
    └── ...
```

几个关键点：

- `BaseException` 是根。直接继承它的那几个（`SystemExit`、`KeyboardInterrupt`、`GeneratorExit`）表示“程序该退出了”，普通代码不该捕获它们。
- `Exception` 是所有普通异常的父类。自定义异常、库异常基本都挂在这下面。
- 子类继承父类：`JSONDecodeError` 是 `ValueError` 的子类，`ValueError` 是 `Exception` 的子类。

Python 的异常类继承关系决定了 `except` 的捕获顺序。

---

## 二、`except` 的匹配规则

### 2.1 子类会被父类的 except 接住

`except X:` 能接住 `X` 以及 `X` 的所有子类。

```python
try:
    json.loads("not-json")
except ValueError as exc:
    ...
```

`json.loads` 抛的是 `JSONDecodeError`，它是 `ValueError` 的子类，所以会被接住。

### 2.2 这就是 `except Exception` 危险的原因

它一口气能接住几乎所有普通异常：

- `KeyringError`（后端失败，预期内）
- `TypeError`（参数写错，代码 bug）
- `AttributeError`（属性名写错，代码 bug）
- `KeyError`（字典键写错，代码 bug）

本来性质完全不同的东西，被同一句 `except` 吞掉，转成同一种对外异常。上层无法精确处理。

### 2.3 捕获顺序：子类必须写在父类前面

```python
# 对
try:
    ...
except KeyringError as exc:
    ...
except Exception as exc:
    ...
```

**越具体的越靠前。**

---

## 三、异常沿调用栈向上传播

### 3.1 传播过程

异常不是凭空跳到某个 `except` 的，它沿着函数调用栈一层层往上走。

```python
def c():
    raise KeyringError("private-marker")

def b():
    c()

def a():
    b()

a()
```

流程：

1. `a()` 调 `b()`，`b()` 调 `c()`
2. `c()` 抛 `KeyringError`
3. 看 `c()` 里有没有 `try/except` 能接 → 没有
4. 传到 `b()`，看 `b()` → 没有
5. 传到 `a()`，看 `a()` → 没有
6. 传到模块顶层，程序终止，打印 traceback

### 3.2 中间层接住会怎样

```python
def b():
    try:
        c()
    except KeyringError as exc:
        raise CredentialStoreError("...") from exc
```

流程变成：

1. `c()` 抛 `KeyringError`
2. 传到 `b()`，被 `b()` 的 `except` 接住
3. `b()` 抛新的 `CredentialStoreError`
4. 新异常从 `b()` 继续往上传播

关键点：**原始异常从 `c` 到 `b` 没消失，因为使用了 `from`，它保存在新异常的 `__cause__` 里。**

### 3.3 每一层的三个选择

异常经过每一层时，那一层的代码有三个选择：

1. **处理**：真的解决问题（重试、换路径），继续往下走
2. **转换**：转成这一层能对外表达的类型，继续往上抛
3. **不接**：让它继续传上去

实际上 1 很少见，大部分层没能力真正解决底层问题。**2 是分层架构里的常态**：每一层把下一层的异常翻译成自己这一层能说的类型。

---

## 四、异常链

### 4.1 什么是 message，以及它为什么敏感

message 就是构造异常时传进去的那个字符串：

```python
raise CredentialStoreError(_SAFE_ERROR_MESSAGE)
```

这里 `_SAFE_ERROR_MESSAGE` 就是新异常的 message。`str(new_exc)` 会返回它。

message 之所以要特别小心，是因为**它会跟着异常一路往上传播，最终可能被打到日志、控制台、错误报告里**。底层的 message 往往包含敏感信息：

- 系统凭据库的路径（可能带用户名）
- 主机名、机器名
- 被访问的服务的地址
- token、key 之类的凭据
- 用户账号、文件名

一旦这些字符串出现在对外异常里，就等于把它们写到了日志或用户界面上。

```python
try:
    self._backend.set_password(...)
except KeyringError as exc:
    raise CredentialStoreError(_SAFE_ERROR_MESSAGE) from exc
```

新异常的 message 是什么，只取决于 `CredentialStoreError(...)` 括号里放的内容：

```python
# message 是固定字符串，安全
raise CredentialStoreError(_SAFE_ERROR_MESSAGE) from exc

# message 是底层异常的字符串，泄露
raise CredentialStoreError(str(exc)) from exc
```

原则：**message 用固定字符串，不拼 `str(exc)`。** 底层信息通过 `from exc` 保留，排查时顺着 `__cause__` 往下看——`__cause__` 不会自动被打到日志里，只有主动去读它的时候才会看到。

从捕获的异常里能看到的东西：

| 表达式                            | 内容                                  |
| --------------------------------- | ------------------------------------- |
| `new_exc`                         | 新异常实例                            |
| `str(new_exc)`                    | 新异常 message，`_SAFE_ERROR_MESSAGE` |
| `new_exc.__cause__`               | 原始异常实例                          |
| `str(new_exc.__cause__)`          | 原始异常的 message，可能敏感          |
| `new_exc.__cause__.__traceback__` | 原始异常的调用栈                      |

### 4.2 多层转换会串成链

```python
# 第 3 层：系统凭据库
def set_password(service, username, password):
    raise KeyringError("keychain locked")

# 第 2 层：适配器
class KeyringCredentialStore:
    def save(self, credentials):
        try:
            self._backend.set_password(...)
        except KeyringError as exc:
            raise CredentialStoreError(_SAFE_ERROR_MESSAGE) from exc

# 第 1 层：业务
def configure_credentials(credentials):
    try:
        store.save(credentials)
    except CredentialStoreError as exc:
        raise ConfigError("配置凭据失败") from exc
```

链变成：

```text
ConfigError（第 1 层抛的）
  └── __cause__ → CredentialStoreError（第 2 层抛的）
        └── __cause__ → KeyringError（第 3 层抛的）
```

每一层做两件事：

- 对外用**自己这一层的类型**，message 自己写
- 用 `__cause__` 保留下一层的原始异常

于是上层只需要 `except ConfigError`，不用知道 `CredentialStoreError` 或 `KeyringError`。排查时顺着 `__cause__` 往下走，最底层的真实原因一目了然。

### 4.3 `__cause__` 和 `__context__`

Python 有两条链：

| 属性          | 谁填的              | 语义                      |
| ------------- | ------------------- | ------------------------- |
| `__cause__`   | `from exc` 显式设置 | “B 就是因为 A 才抛的”     |
| `__context__` | Python 自动         | “在处理 A 的时候又抛了 B” |

- `__cause__` 是主动声明的关系，语义强、准确。
- `__context__` 是 Python 自动推断的，可能只是“碰巧在同一个 except 里”。

不加 `from` 时，`__cause__ = None`，只有 `__context__`。打印 traceback 时：

- 有 `__cause__` → `The above exception was the direct cause of...`
- 只有 `__context__` → `During handling of the above exception, another exception occurred:`

做转换时，**用 `from exc` 显式声明因果关系比依赖自动的 `__context__` 更准。**

### 4.4 什么时候不用 `from exc`

如果异常是**自己主动发现**的，不是“转换别人的”，就没有原异常可保留：

```python
if not isinstance(payload, dict):
    raise CredentialStoreError(_SAFE_ERROR_MESSAGE)
```

---

## 五、总结

### 5.1 捕获

1. 只捕具体异常：能写 `KeyringError` 就别写 `Exception`。
2. 子类写在父类前面。
3. 每种失败分开捕。
4. 不捕自己处理不了的异常——让它传出去。

### 5.2 转换

| 场景                           | 用 `from exc` 吗 |
| ------------------------------ | ---------------- |
| 在 `except` 里转换别人抛的异常 | 用               |
| 自己主动检查发现的问题         | 不用             |

### 5.3 message

1. 用固定字符串，因为 message 会随异常向上传播，可能被写进日志或展示给用户。
2. 不拼 `str(exc)`，底层消息里可能含路径、主机名、token 等敏感信息。
3. 底层信息留给 `__cause__`，它不会自动被打印。

### 5.4 传递

- 异常沿调用栈向上传播，每层可“处理 / 转换 / 不接”。
- 分层架构里，**转换是常态**。
- 多层转换形成链：`ConfigError → CredentialStoreError → KeyringError`。
- 每层的调用栈存在对应异常的 `__traceback__` 里，顺着 `__cause__` 往下都能看到。
