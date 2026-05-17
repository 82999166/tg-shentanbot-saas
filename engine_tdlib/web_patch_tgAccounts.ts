/**
 * ═══════════════════════════════════════════════════════════════
 * 神探监控引擎 v5.0 (TDLib) - Web 端适配补丁
 * 
 * 文件: server/api/routers/tgAccounts.ts
 * 
 * 说明: TDLib 登录服务的接口与 Pyrogram 登录服务完全兼容，
 *       Web 端只需做以下最小改动即可完成迁移。
 * ═══════════════════════════════════════════════════════════════
 * 
 * 改动总结：
 * 
 * 1. verifyCode 方法中：登录成功后增加 finalize_login 调用
 * 2. verify2FA 方法中：同上
 * 3. saveAccount 函数中：sessionString 语义变化处理
 * 4. testConnection 方法：已支持 TDLib 模式（无需修改）
 * 5. importSessions 方法：保留但标注仅适用于 Pyrogram 旧账号
 * 
 * 前端完全不需要修改！登录流程的 UI 交互保持不变。
 */

// ═══════════════════════════════════════════════════════════════
// 改动 1: verifyCode 方法
// 位置: 约第 213-235 行
// ═══════════════════════════════════════════════════════════════

/*
原代码 (第 231-234 行):
```
      // 登录成功，保存 Pyrofork session_string
      const sessionVal = data.session_string ?? "";
      if (!sessionVal) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "登录服务未返回 session_string" });
      return await saveAccount(ctx.user, phone, sessionVal);
```

替换为:
*/

// --- verifyCode 修改后的代码 ---
/*
      // 登录成功
      const sessionVal = data.session_string ?? "";
      if (!sessionVal) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "登录服务未返回 session 标识" });

      // 保存账号（sessionString 在 TDLib 模式下是文件路径标记）
      const result = await saveAccount(ctx.user, phone, sessionVal);

      // TDLib 模式：通知登录服务将临时 session 移动到正式目录
      if (result.accountId) {
        try {
          await callLoginService("/finalize_login", { phone, account_id: result.accountId });
        } catch (e) {
          console.warn(`[verifyCode] finalize_login 调用失败（不影响登录结果）:`, e);
        }
      }

      return result;
*/

// ═══════════════════════════════════════════════════════════════
// 改动 2: verify2FA 方法
// 位置: 约第 238-254 行
// ═══════════════════════════════════════════════════════════════

/*
原代码 (第 250-253 行):
```
      // 二步验证成功，保存 Pyrofork session_string
      const sessionVal = data.session_string ?? "";
      if (!sessionVal) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "登录服务未返回 session_string" });
      return await saveAccount(ctx.user, phone, sessionVal);
```

替换为:
*/

// --- verify2FA 修改后的代码 ---
/*
      // 二步验证成功
      const sessionVal = data.session_string ?? "";
      if (!sessionVal) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "登录服务未返回 session 标识" });

      // 保存账号
      const result = await saveAccount(ctx.user, phone, sessionVal);

      // TDLib 模式：通知登录服务将临时 session 移动到正式目录
      if (result.accountId) {
        try {
          await callLoginService("/finalize_login", { phone, account_id: result.accountId });
        } catch (e) {
          console.warn(`[verify2FA] finalize_login 调用失败（不影响登录结果）:`, e);
        }
      }

      return result;
*/

// ═══════════════════════════════════════════════════════════════
// 改动 3: 注释更新（可选，提高代码可读性）
// 位置: 第 22 行
// ═══════════════════════════════════════════════════════════════

/*
原代码:
  // ─── Pyrogram 登录服务地址（本地 Python HTTP 服务）─────────────────────────
  const LOGIN_SERVICE_URL = process.env.LOGIN_SERVICE_URL ?? "http://127.0.0.1:7002";

替换为:
  // ─── TDLib 登录服务地址（本地 Python HTTP 服务）─────────────────────────────
  const LOGIN_SERVICE_URL = process.env.LOGIN_SERVICE_URL ?? "http://127.0.0.1:7002";
*/

// ═══════════════════════════════════════════════════════════════
// 无需修改的部分（已天然兼容）
// ═══════════════════════════════════════════════════════════════

/*
以下功能无需修改，因为 TDLib 登录服务保持了相同的 HTTP API 接口：

1. sendCode: 调用 /send_code → TDLib 登录服务正确处理
2. testConnection: 已有 TDLib 路径判断逻辑（第 452-460 行）
3. callLoginService: 通用 HTTP 调用函数，无需修改
4. getDialogs: 调用 /get_dialogs → TDLib 登录服务正确处理
5. saveAccount: sessionString 存储的是 TDLib session 路径标记，
   Master 进程通过检查 td.binlog 文件存在来判断是否可启动 Worker

关于 delete 方法中的 PM2 进程管理：
  TDLib 使用 Master 模式管理所有 Worker，不再为每个账号创建独立 PM2 进程。
  删除账号后，Master 在下一次检查循环中会自动停止对应的 Worker。
  可以保留现有的 PM2 delete 逻辑作为兼容（不会报错，只是找不到进程）。
*/
