import type { CookieOptions, Request } from "express";

export function getSessionCookieOptions(
  _req: Request
): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  // 使用 Lax 兼容 HTTP 和 HTTPS 环境
  // SameSite=None 需要 Secure=true，在 HTTP 下浏览器会拒绝保存 cookie
  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: false,
  };
}
