---
title: HTTP 观察与踩坑
date: 2026-09-21 21:24:41
tags:
  - 计算机网络
categories:
  - 开发日记
excerpt: 梳理 HTTP 通信、报文结构、状态码与重定向机制，并结合校园网 Portal 探测记录 URL 解析、软重定向及探测目标选择中的常见问题。
---

# HTTP 观察与踩坑

## 一、HTTP 基础回顾

### 1. HTTP 是什么

HTTP 是**应用层协议**，采用"请求—响应"模型。本身**无状态**。

一次交互：

```text
客户端  --->  服务器   发送请求
客户端  <---  服务器   返回响应
```

HTTP 通常基于 TCP。所以真实顺序是：

```text
先建立 TCP 连接
再发送 HTTP 请求
再接收 HTTP 响应
```

### 2. 一次完整通信的 8 步

以 `http://example.com/login` 为例：

1. **解析 URL**：协议 `http`、主机 `example.com`、路径 `/login`、端口 `80`
2. **DNS 解析**：域名 → IP
3. **建立 TCP 连接**：三次握手
4. **发送 HTTP 请求报文**
5. **服务器处理请求**
6. **返回 HTTP 响应报文**
7. **客户端处理响应**
8. **关闭或复用连接**（HTTP/1.1 默认长连接）

### 3. URL 结构

```text
http://example.com/login
 协议      主机        路径
```

常见组成部分：

- 协议：`http` / `https`
- 主机：`example.com`
- 端口：HTTP 默认 `80`，HTTPS 默认 `443`
- 路径：`/login`
- 查询参数：`?id=1`
- 片段：`#top`（通常不发给服务器）

**关键**：主机（host）和查询参数（query）是不同字段。这一点在安全判断里很重要。

---

## 二、HTTP 报文结构

### 1. 请求报文

```http
GET /login HTTP/1.1
Host: example.com
User-Agent: Mozilla/5.0
Accept: text/html

```

四部分：

1. **请求行**：方法 + 路径 + 版本
2. **请求头**：`Host`、`User-Agent`、`Accept`、`Cookie` 等
3. **空行**：分隔头和体
4. **请求体**：GET 通常没有；POST 可能有表单、JSON

常见方法：

| 方法    | 含义           |
| ------- | -------------- |
| GET     | 获取资源       |
| POST    | 提交数据       |
| PUT     | 更新资源       |
| DELETE  | 删除资源       |
| HEAD    | 只要响应头     |
| OPTIONS | 查询支持的方法 |

### 2. 响应报文

```http
HTTP/1.1 302 Found
Location: https://portal.example.com/auth
Content-Type: text/html; charset=utf-8

<html>...</html>
```

四部分：

1. **状态行**：版本 + 状态码 + 原因短语（原因短语是给人看的，程序主要看状态码）
2. **响应头**：`Location`、`Content-Type`、`Set-Cookie`、`Content-Length` 等
3. **空行**
4. **响应体**：HTML、JSON、图片字节，或空

**关键点**：

- 字段名大小写不敏感
- 对于 302，关键信息在**状态码**和 `Location` 头里
- `Location` 属于 Headers，**不是 Body**

---

## 三、HTTP 状态码

五类分组：

```text
1xx：信息
2xx：成功
3xx：重定向
4xx：客户端错误
5xx：服务器错误
```

常见状态码：

| 状态码 | 含义                       |
| ------ | -------------------------- |
| 200    | OK                         |
| 204    | No Content（成功且无正文） |
| 301    | 永久重定向                 |
| 302    | 临时重定向                 |
| 303    | See Other                  |
| 307    | 临时重定向，保持方法       |
| 308    | 永久重定向，保持方法       |
| 400    | 请求错误                   |
| 401    | 未认证                     |
| 403    | 禁止访问                   |
| 404    | 资源不存在                 |
| 500    | 服务器内部错误             |
| 502    | 网关错误                   |
| 503    | 服务不可用                 |

---

## 四、重定向与 Location

### 1. 典型 302

```http
HTTP/1.1 302 Found
Location: https://portal.example.com/auth
```

浏览器默认行为：

```text
收到 302
→ 读取 Location
→ 自动再发一个请求到 Location
→ 拿到新地址的响应
```

这叫**跟随重定向**。

### 2. 校园网 Portal 场景的重定向

```text
客户端请求外网地址
→ 网关拦截
→ 返回 302
→ Location 指向认证页面
```

如果自动跟随：

```text
原始请求 → 302 → 自动跳转认证页 → 200
```

最终只能看到认证页的 `200`，反而丢失了"被重定向到认证页"这个关键信息。

所以观察单元必须：

```text
禁止自动跟随重定向
保留原始 302 和 Location
```

HTTP 协议定义了 `302` 和 `Location`，但"是否跟随重定向"是**客户端行为**，不是协议强制。

### 3. 软重定向：meta refresh

有些网关不用 3xx，而是返回一个 **200 的跳板页**：

```http
HTTP/1.1 200 OK
Content-Type: text/html

<html>
<head>
    <meta http-equiv="refresh" content="0;url=srun_portal_pc?ac_id=1">
</head>
<body></body>
</html>
```

`<meta http-equiv="refresh">` 是**应用层的跳转**：

```text
content="0;url=srun_portal_pc?ac_id=1"
          ↑   ↑
          |   └── 目标地址
          └────── 等待秒数（0 = 立即）
```

`&amp;` 是 HTML 实体，等价于 `&`。

**关键区别**：

| 类型           | 层级    | 触发者         |
| -------------- | ------- | -------------- |
| 3xx + Location | HTTP 层 | 客户端自动跟随 |
| meta refresh   | 应用层  | 浏览器主动跳转 |

所以 `PORTAL_REQUIRED` 有以下两种可能：

- 3xx + Location 主机名
- 200 + 正文含 `srun_portal`（西电的 Portal 认证是深澜）

---

## 五、绝对 URL 和相对 URL

### 1. 两种形式

```text
https://w.xidian.edu.cn/srun_portal_pc?ac_id=1   ← 绝对 URL
srun_portal_pc?ac_id=1                            ← 相对 URL
/login                                            ← 相对 URL
```

相对 URL 省略协议和主机。浏览器会参考当前页面地址拼出完整 URL：

```text
当前页面：https://w.xidian.edu.cn
相对 URL：/login
最终跳转：https://w.xidian.edu.cn/login
```

### 2. 对解析的影响

```python
urlparse("/login").hostname  # None
```

相对 URL 没有 `//` 引导的 netloc，所以 `hostname` 是 `None`。

所以在解析前应该把 `url` 字段拼接好。

---

## 六、URL 解析：urlparse

```python
from urllib.parse import urlparse

u = urlparse("http://w.xidian.edu.cn/login?next=abc")
u.hostname  # 'w.xidian.edu.cn'
u.path      # '/login'
u.query     # 'next=abc'
```

`.hostname` 只取主机名，不带端口、路径、查询参数。

### 不能用字符串 `in` 判断主机

错误写法：

```python
if "w.xidian.edu.cn" in location:  # 会被 query 带偏
```

例如：

```text
http://evil.com/?next=w.xidian.edu.cn
```

正确做法：

```python
if urlparse(location).hostname in portal_hosts:
```

**安全原则**：永远不要用字符串包含关系判断 URL 的主机，必须用解析器取 host 字段。

---

## 七、踩坑日记：探测目标的选取

**踩坑**：认证后访问 `w.xidian.edu.cn` 仍然返回含 `srun_portal` 的页面。

原因：**门户服务器本身就是认证入口**，无论在线与否都会返回登录页。

**因此不能用门户服务器来探测在线状态。**

应该请求**外网地址**：

- `http://connect.rom.miui.com/generate_204`（专门返回 204）

这样：

- **未认证**：网关拦截，返回 302 或软重定向 → `PORTAL_REQUIRED`
- **已认证**：请求直达外网 → 204 → `ONLINE`

---

## 八、Python 知识点

### 1. `frozenset`

- `set` 可变，`frozenset` 不可变
- 规则数据适合 `frozenset`：不可被意外修改，且可哈希
- `in` 查找平均 O(1)，比 list 快

### 2. 枚举 `Enum`

```python
from enum import Enum

class NetworkState(Enum):
    ONLINE = "online"
    PORTAL_REQUIRED = "portal_required"
    UNKNOWN = "unknown"
```

- `NetworkState` 是**枚举类**
- `NetworkState.ONLINE` 是**枚举成员**（类的实例，单例）
- `.name` → `"ONLINE"`，`.value` → `"online"`

返回枚举成员比返回字符串更好：类型安全、IDE 可补全、可遍历、可比较。

### 3. `is not None` vs `!= None`

判断 None 用 `is not None`，不用 `!= None`。
`is` 是身份比较，不受 `__eq__` 重写影响。
