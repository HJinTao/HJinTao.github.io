---
title: TLS 过程
date: 2026-09-22 14:32:38
tags:
  - 计算机网络
categories:
  - 开发日记
excerpt: 梳理 TLS 在 HTTPS 中的位置与完整握手流程，重点说明 SNI、证书校验、会话密钥协商，以及使用域名而非 IP 发起 HTTPS 请求的原因。
---

# TLS 过程

---

## 1. TLS 的目标与位置

TCP 连接建立后，双方之间是一条**明文**通道。TLS 要在正式传输 HTTP 数据之前完成两件事：

```text
目标 A：客户端验证服务器身份（防止冒充）
目标 B：双方协商出只有彼此知道的会话密钥（防止窃听和篡改）
```

TLS 夹在 HTTP 和 TCP 之间：

```text
HTTP     <- 应用层，请求格式不变
TLS      <- 加密层，新增
TCP      <- 传输层，不变
IP       <- 网络层，不变
```

HTTPS = HTTP over TLS。端口从 80 变成 443 只是约定。必须先有 TCP 连接，才能开始 TLS 握手。

---

## 2. TLS 握手完整流程

### 前提：TCP 三次握手完成

```text
客户端 <---- TCP 三次握手 ----> 服务器
```

此时双方可以互相发送字节，但内容都是明文。

---

### 第 1 步：ClientHello（客户端 → 服务器）

客户端发送第一个 TLS 报文 **ClientHello**，内容主要包括：

```text
1. 支持的 TLS 版本（如 TLS 1.3）
2. 支持的密码套件列表
3. 客户端随机数（Client Random）
4. SNI 扩展（如果访问的是域名）
```

**SNI（Server Name Indication）** 在这里出现。

为什么需要 SNI？

先看一个前提：**一个 IP 上可以托管多个 HTTPS 网站。**

```text
192.0.2.10 是一台服务器
这台机器上运行着 Web 服务器软件（如 nginx）
nginx 监听 443 端口，配置里写了多个 server 块：

server {
    listen 443 ssl;
    server_name probe.example.test;
    ssl_certificate /certs/probe.crt;
}
server {
    listen 443 ssl;
    server_name www.shop.com;
    ssl_certificate /certs/shop.crt;
}
server {
    listen 443 ssl;
    server_name api.service.com;
    ssl_certificate /certs/api.crt;
}
```

这三个站点共用同一个 IP 和同一个端口，不是三台机器。nginx 根据请求里的信息决定返回哪个站点的内容。

**HTTP 下靠 Host 头区分：**

```http
GET /generate_204 HTTP/1.1
Host: probe.example.test
```

nginx 拿 Host 值去匹配 `server_name`，匹配到哪个就返回哪个站点的内容。

**HTTPS 下，TLS 握手阶段还没有 HTTP 请求，看不到 Host 头。**
但此时 nginx 就必须决定发哪张证书。它靠的就是 ClientHello 里的 **SNI**：

```text
ClientHello:
  SNI = probe.example.test
```

nginx 拿 SNI 值匹配 `server_name`，匹配到 `probe.example.test`，就发 `/certs/probe.crt`。

所以：

```text
HTTP:  靠 Host 头区分站点（HTTP 请求里）
HTTPS: 靠 SNI 区分站点（TLS 握手阶段）
      之后 HTTP 请求进来，仍靠 Host 头确认
```

关键点：

- SNI 是**明文**的（标准 TLS 中）。
- SNI 必须是**域名**。RFC 6066 规定 SNI 的 `host_name` 字段类型是 DNS 主机名，**不允许填 IP 字面量**。
- 用 IP 访问 HTTPS 时，客户端不会发 SNI（或发空），nginx 无法匹配到具体 `server_name`，只能返回默认虚拟主机的证书，通常 SAN 不包含该 IP，后续证书校验失败。

---

### 第 2 步：ServerHello（服务器 → 客户端）

服务器收到 ClientHello 后，回复 **ServerHello**，内容主要包括：

```text
1. 选定的 TLS 版本
2. 选定的密码套件
3. 服务器随机数（Server Random）
```

此时双方已经就“用哪套加密算法”达成一致。

---

### 第 3 步：Certificate（服务器 → 客户端）

服务器紧接着把自己的**证书**发给客户端。

证书是一个数据结构，由权威机构（CA）签发，关键字段：

```text
Subject（主体）      : probe.example.test     <- 属于谁
Issuer（签发者）     : Some CA                <- 谁签的
Public Key（公钥）   : xxxx                    <- 用于密钥协商
Validity（有效期）   : 2026-01-01 ~ 2027-01-01
Signature（签名）    : xxxx                    <- CA 对以上内容的签名
SAN（主体备用名）    : DNS:probe.example.test  <- 真正校验用这个
```

关键点：

1. **证书绑定的是域名，不是 IP。**
2. **证书由 CA 签名，客户端信任 CA。** 客户端本地有受信任 CA 列表，用 CA 公钥验证签名。
3. 证书本身是公开信息，所以明文发送没有问题。

---

### 第 4 步：客户端校验证书

客户端拿到证书后，做三项检查，任何一项失败，TLS 握手立即终止。

#### 检查 1：信任链

证书是不是由客户端信任的 CA 签发的？

- 防“自签证书冒充”。攻击者自己做证书，没有受信任 CA 签名，过不了。

#### 检查 2：域名匹配

证书的 SAN 字段里，有没有客户端正在访问的那个名字？

- 防“用别的网站的证书冒充”。

#### 检查 3：有效期

当前时间是否在证书 Validity 范围内？

- 防“旧证书被滥用”。

三项全通过，TLS 握手继续。任何一项失败，连接终止。

HTTP 请求里可能带 Cookie、密码、token，TLS 握手成功前**不会发送任何 HTTP 数据**。

---

### 第 5 步：协商会话密钥

身份验证通过后，双方还要协商出一个**只有彼此知道**的会话密钥。这个密钥用来加密后续所有 HTTP 数据。

密钥不能直接在网络上明文传输，否则会被中间人攻击。

TLS 用的方法大致是：

```text
双方各自生成一个秘密材料
通过交换一些公开的数学值，各自算出相同的密钥
```

- 交换过程中传输的值是公开的
- 但只有双方能算出最终密钥
- 中间人无法通过公开值攻击

---

### 第 6 步：Finished 与加密传输

双方各自发送 **Finished** 报文，验证握手过程没有被篡改。
之后进入加密传输阶段：

```text
双方各自持有相同的会话密钥
后续 HTTP 数据用这个密钥加密
```

完整时间线：

```text
TCP 三次握手完成
   ↓
客户端 -> 服务器: ClientHello（明文，含 SNI）
服务器 -> 客户端: ServerHello（明文）
服务器 -> 客户端: Certificate（明文，证书本就公开）
客户端: 校验证书（信任链、域名、有效期）
   失败 → 立即终止
   成功 → 继续
双方: 协商会话密钥（基于公开值各自算出）
双方: Finished
   ↓
HTTP 请求/响应（全部加密）
```

---

## 3. TLS 中的关键概念

| 概念     | 在 TLS 中的位置  | 作用                   |
| -------- | ---------------- | ---------------------- |
| SNI      | ClientHello      | 告诉服务器该发哪张证书 |
| 证书     | Certificate 报文 | 承载服务器身份和公钥   |
| CA       | 证书的 Issuer    | 客户端信任的签发机构   |
| 证书校验 | 收到证书后       | 信任链、域名、有效期   |
| 会话密钥 | 握手最后阶段     | 加密后续 HTTP 数据     |
| Finished | 握手最后         | 验证握手未被篡改       |

---

## 4. HTTP 阶段必须用原始 URL

访问 `https://probe.example.test/generate_204` 的完整过程：

```text
1. DNS:  probe.example.test -> 192.0.2.10
2. TCP:  连接 192.0.2.10:443
3. TLS:  ClientHello 带 SNI = probe.example.test
         服务器返回 probe.example.test 的证书
         客户端校验证书 SAN = probe.example.test ✓
4. HTTP: GET /generate_204
         Host: probe.example.test
```

如果第 3、4 步把域名换成 IP：

```text
3. TLS:  SNI 缺失或为 IP，服务器返回默认证书
         客户端校验：请求的是 IP，证书 SAN 不含该 IP → 失败
4. HTTP（假设 TLS 通过）: Host: 192.0.2.10
         服务器不知道客户端要访问 192.0.2.10 的哪个站点
```

| 阶段 | 用什么               | 为什么                      |
| ---- | -------------------- | --------------------------- |
| DNS  | 域名 → 得 IP         | DNS 就是干这个的            |
| TCP  | 用 IP 去连           | TCP 只认 IP                 |
| HTTP | **原始 URL（域名）** | 保留 Host 头、SNI、证书校验 |

**DNS 和 TCP 用 IP 探路；HTTP 用域名正确对话。**
