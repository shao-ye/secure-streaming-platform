# SSH免密登录手动设置指南

## 🎯 目标
设置SSH免密登录到VPS服务器 142.171.75.220

## 📋 VPS连接信息
- **主机**: 142.171.75.220
- **用户**: root  
- **密码**: kNX66a7P3q6rtCV5Ql

## 🔑 你的SSH公钥
```
ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCr3PAbd1d447ZC2LPZ6cT0HOkDOMT6CFXmiVu47TfovRycoBBlq3I/KFp4AdXDwPZyB0uN926hYY+/X7dhUzggjo4iB7ZZx0ixiE1V64cN9QR4o5BdigUyeG7OL/e/n37KhvBzXTjWlY0L1raQWhNJI3/7axLyYhlCWxeYXWNcS4J4tTpGUDizmg6Mswzjvhvsz2fvSVrFz0DId9YZmQSqyV1n0/nDOf3He92JQz4Uol/q9qS6AxLXyc+P2d6VCE2BBNFmr4wrKqWGYMN5vJROgK32PDDqxC4ezNAliT353Q6BbCY22AmhqPlXjMWfYFzV4dPE1cj3qVZUJRIs3yG2UGuYPaqAZ1NaT1hjYNGj+KZkTLIk0z4xAPNT8w7lBHX4DKD4byuH1lBqKL6411RbCwmlhxtvmRtiBxAEE/EJntmSeY3ZNUDVTjCXdjLf2wA+MBOrcP/duzKVyCf+jZl6KPeVQBUdZXAyNYPOk7QQAQVbSmmnct4/eNrvw3MevS8= shaos@LAPTOP-LD0G5F1R
```

## 🚀 手动设置步骤

### 步骤1: 连接到VPS
```bash
ssh root@142.171.75.220
```
**输入密码**: `kNX66a7P3q6rtCV5Ql`

### 步骤2: 在VPS上执行以下命令
```bash
# 创建.ssh目录（如果不存在）
mkdir -p ~/.ssh

# 设置正确的权限
chmod 700 ~/.ssh

# 编辑authorized_keys文件
nano ~/.ssh/authorized_keys
```

### 步骤3: 将公钥添加到authorized_keys
在nano编辑器中，粘贴以下公钥内容（一行）：
```
ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCr3PAbd1d447ZC2LPZ6cT0HOkDOMT6CFXmiVu47TfovRycoBBlq3I/KFp4AdXDwPZyB0uN926hYY+/X7dhUzggjo4iB7ZZx0ixiE1V64cN9QR4o5BdigUyeG7OL/e/n37KhvBzXTjWlY0L1raQWhNJI3/7axLyYhlCWxeYXWNcS4J4tTpGUDizmg6Mswzjvhvsz2fvSVrFz0DId9YZmQSqyV1n0/nDOf3He92JQz4Uol/q9qS6AxLXyc+P2d6VCE2BBNFmr4wrKqWGYMN5vJROgK32PDDqxC4ezNAliT353Q6BbCY22AmhqPlXjMWfYFzV4dPE1cj3qVZUJRIs3yG2UGuYPaqAZ1NaT1hjYNGj+KZkTLIk0z4xAPNT8w7lBHX4DKD4byuH1lBqKL6411RbCwmlhxtvmRtiBxAEE/EJntmSeY3ZNUDVTjCXdjLf2wA+MBOrcP/duzKVyCf+jZl6KPeVQBUdZXAyNYPOk7QQAQVbSmmnct4/eNrvw3MevS8= shaos@LAPTOP-LD0G5F1R
```

### 步骤4: 保存并设置权限
```bash
# 保存文件 (Ctrl+X, 然后Y, 然后Enter)

# 设置authorized_keys文件权限
chmod 600 ~/.ssh/authorized_keys

# 验证文件内容
cat ~/.ssh/authorized_keys
```

### 步骤5: 退出VPS连接
```bash
exit
```

## 🧪 测试免密登录
```bash
ssh root@142.171.75.220
```

如果设置成功，应该不再需要输入密码！

## 🔧 故障排除

### 如果仍然需要密码：
1. **检查文件权限**:
   ```bash
   ssh root@142.171.75.220 "ls -la ~/.ssh/"
   ```
   应该看到：
   - `drwx------` (700) 对于 `.ssh` 目录
   - `-rw-------` (600) 对于 `authorized_keys` 文件

2. **检查公钥内容**:
   ```bash
   ssh root@142.171.75.220 "cat ~/.ssh/authorized_keys"
   ```

3. **检查SSH服务配置**:
   ```bash
   ssh root@142.171.75.220 "grep -E '^(PubkeyAuthentication|AuthorizedKeysFile)' /etc/ssh/sshd_config"
   ```

### 如果SSH连接卡死：
使用超时参数：
```bash
ssh -o ConnectTimeout=10 -o ServerAliveInterval=5 root@142.171.75.220
```

## ✅ 成功标志
- 执行 `ssh root@142.171.75.220` 不再提示输入密码
- 直接进入VPS命令行界面
