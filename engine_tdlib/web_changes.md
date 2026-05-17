# Web 端适配 TDLib 引擎的修改清单

## 概述

TDLib 引擎的登录服务接口**完全兼容**原 Pyrogram 版本，前端无需修改。
后端只需要在 `verifyCode` 和 `verify2FA` 成功后，额外调用一个 `/finalize_login` 接口。

## 修改文件

### `server/routers/tgAccounts.ts`

#### 修改 1: verifyCode mutation（约第 232 行）

在 `return await saveAccount(...)` 之前，添加 finalize_login 调用：

```typescript
// 登录成功，通知登录服务将 session 移动到正式目录
const savedAccount = await saveAccount(ctx.user, phone, sessionVal);
// 通知 TDLib 登录服务完成迁移
await callLoginService("/finalize_login", { 
  phone, 
  account_id: savedAccount.accountId 
}).catch(e => console.warn("finalize_login failed:", e));
return savedAccount;
```

#### 修改 2: verify2FA mutation（约第 252 行）

同上，在 saveAccount 后调用 finalize_login。

#### 修改 3: saveAccount 函数

`sessionString` 字段不再存储实际的 session 数据，改为存储标记：

```typescript
// 原来：sessionString 存储 Pyrogram 的 base64 session
// 现在：存储 TDLib 标记（仅用于标识该账号已登录）
const sessionVal = data.session_string ?? "";
// sessionVal 现在是 "tdlib_session_+86xxx" 格式的标记
```

#### 修改 4: importSessions（可选）

批量导入 session_string 功能在 TDLib 架构下不再适用。
可以保留接口但返回提示信息，引导用户通过手机号登录。

## 注意事项

1. **向后兼容**：旧的 Pyrogram session_string 数据不需要删除，
   TDLib 引擎不使用它，只使用本地文件 session。
   
2. **登录状态判断**：引擎通过检查 `tdlib_data/account_{id}/td.binlog` 
   文件是否存在来判断账号是否已登录。

3. **无需修改前端**：所有 tRPC mutation 的输入输出格式保持不变。
