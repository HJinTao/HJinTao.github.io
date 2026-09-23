---
title: Python 模块、包与导入机制
date: 2026-09-21 15:30:11
tags:
  - Python
categories:
  - 开发日记
excerpt: 梳理 Python 模块、包与导入机制，解析 sys.path、sys.modules、循环导入及不同运行方式带来的常见问题。
---

# Python 模块、包、导入机制笔记

## 1. 模块

**模块**是 Python 导入系统加载的代码单元，最常见的是一个 `.py` 文件。

```python
import math
```

- `__name__` 字段：被其他模块导入时是模块名（如 `math`），直接运行时是 `__main__`

## 2. 包

**包**是可以包含其他模块、子包的模块容器。传统形式：一个目录 + 目录里有 `__init__.py`。

如我的项目：

```text
src/
└── xduwlan/
    └── probe/
        ├── __init__.py
        └── http.py
```

对应模块名层级：

```text
xduwlan              顶层包
xduwlan.probe        子包
xduwlan.probe.http   子包里的模块
```

- 目录名不等于自动的包名。
- 有 `__init__.py` 的目录本身已是包目录，但还需要父目录在 `sys.path` 中才能被导入。
- 直接运行文件时，不会自动走包导入流程。

## 3. Python 如何寻找模块 —— `sys.path`

执行 `import http.client` 时，Python：

1. 把 `http.client` 当作**模块名**。
2. 先查 `sys.modules`（类似快慢表中的快表）。
3. 若没有，按 `sys.path` 这个**目录列表**顺序查找。
4. 找到第一个匹配的就不再往后找。

`sys.path` 典型包含：

1. 某个起点目录（取决于运行方式，后文会提到）
2. `PYTHONPATH` 中的目录
3. 标准库目录
4. `site-packages`：当前 Python 环境里安装第三方包的目录，它本身已经在 `sys.path` 中。

**规则：按顺序找，前面的会遮蔽后面的同名模块。**

## 4. `sys.modules` 与循环导入

`sys.modules` 是**已加载模块的缓存字典**：key是模块名，value是模块对象。

`import` 完整过程：

1. 把名字当模块名。**先查 `sys.modules`**。
2. 若已有，直接返回缓存对象，**不重新执行**。
3. 若没有，按 `sys.path` 查找。
4. 找到后，创建模块对象。
5. **模块对象先放进 `sys.modules`**（此时还没执行完）。
6. 执行模块顶层代码。
7. 执行完成后，模块才真正初始化完成。

**关键：**

> 模块对象在代码执行完成之前就注册进 `sys.modules`。
> 因此，如果另一个模块在它还没执行完时导入它，会拿到一个**Partially Initialized**的模块对象。

## 5. 运行方式如何改变 `sys.path` 起点

| 维度               | `python file.py`                 | `python -m package.module` |
| ------------------ | -------------------------------- | -------------------------- |
| 接收对象           | 文件路径                         | 模块名                     |
| 身份               | 主脚本，`__name__ == "__main__"` | 模块，以主程序运行         |
| `sys.path` 最前    | **脚本所在目录**                 | **当前工作目录 CWD**       |
| 父包 `__init__.py` | 不自动执行                       | 自动执行                   |
| 相对导入           | 通常失败                         | 可用                       |
| 顶层模块名         | 不会自动获得                     | 从包名开始解析             |

## 6. 如何让有 `__init__.py` 的目录真正可导入

有 `__init__.py` 的目录本身已是包目录。

真正要做的是让它的**父目录进入 `sys.path`**。

### 三种方式

**A. 临时进入父目录运行**

```bash
cd /xx/x/x/x/x
python -m xduwlan.probe.http
```

**B. 可编辑安装（推荐）**

> 需要 `pyproject.toml`

```bash
cd /xx/x/x/x/x
pip install -e .
```

- 普通安装 → `site-packages/xduwlan/__init__.py`
- 可编辑安装 → `.../src/xduwlan/__init__.py`

## 7. 安装

**安装只做了一件事：让包的父目录进入 `sys.path` 覆盖范围。**

### 普通安装 `pip install .`

改源码后副本不更新，开发期麻烦。

- 根据 `pyproject.toml `构建 wheel
- **把 `xduwlan` 包目录复制到 `site-packages/`**。
- 写入 `.dist-info` 元数据。

> `site-packages` 本来就在 `sys.path` 中，所以能被找到。

### 可编辑安装 `pip install -e .`

类似软链接，告诉 `site-packages` 真实源码在哪，改源码立刻生效。

## 8.踩坑日记

### Question —— `python src/xduwlan/probe/http.py`

直接运行文件时，`sys.path` 最前是脚本目录 `.../probe`，里面有本地 `http.py`， `http.py`又导入`urllib`，遮蔽了`urllib`的标准库

```text
python file.py
→ 脚本目录进 sys.path 最前
→ 本地 http.py 遮蔽标准库 http
→ 循环导入
→ 部分初始化错误
```

### Answer —— `python -m xduwlan.probe.http`

`-m` 按模块名导入，`sys.path` 最前是当前工作目录。当前工作目录没有 `http.py`，于是按包结构导入 `xduwlan.probe.http`。`urllib.request` 内部 `import http.client` 时找到标准库 `http`，冲突消失。

## 9. 为什么正常开发都要安装

开发期安装，是为了让包在**任意目录、任意入口、任意工具**里，都能用**同一个模块名**被稳定找到，并且源码改动立即生效。

### 方便

- 任意目录、任意入口都能 `import xduwlan...`
- `pytest`、类型检查、IDE、`python -m` 都用同一套导入模型
- 源码改动立即生效（`-e`）

### 避免

- 每次手动摆弄 `sys.path`
- 导入结果依赖运行位置
- 同一文件身份混乱（`__main__` vs `http`）导致遮蔽和循环导入
- 工具链找不到包
- 改了源码跑旧副本

## 心得

- 项目用 `src` 布局 + `pyproject.toml` + `pip install -e .`
- 运行用 `python -m package.module`
- 文件命名避免与标准库顶层模块同名（如 `http.py`、`json.py`、`types.py`）
