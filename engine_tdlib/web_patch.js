/**
 * 这是给 Web 端 server/api/routers/tgAccounts.ts 的修改说明
 * 
 * TDLib 的登录流程中，验证码和二步验证成功后，需要在保存账号后
 * 通知登录服务将 session 文件从 login_ 临时目录移动到正式的 account_ 目录。
 * 
 * 只需要在 saveAccount() 调用成功后，增加一个 HTTP POST 请求：
 * 
 * const response = await fetch(`${process.env.LOGIN_SERVICE_URL || 'http://127.0.0.1:7002'}/finalize_login`, {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({ phone, account_id: account.id })
 * });
 */
