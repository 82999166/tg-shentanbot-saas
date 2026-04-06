import nodemailer from "nodemailer";
import { getDb } from "./db";
import { systemSettings } from "../drizzle/schema";

// 从系统设置中获取 SMTP 配置
async function getSmtpConfig() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // 批量获取所有 smtp 配置
  const allSettings = await db.select().from(systemSettings);
  const get = (key: string) => allSettings.find((s: any) => s.key === key)?.value || "";

  return {
    host: get("smtp_host") || process.env.SMTP_HOST || "",
    port: parseInt(get("smtp_port") || process.env.SMTP_PORT || "465"),
    secure: (get("smtp_secure") || process.env.SMTP_SECURE || "true") === "true",
    user: get("smtp_user") || process.env.SMTP_USER || "",
    pass: get("smtp_pass") || process.env.SMTP_PASS || "",
    from: get("smtp_from") || process.env.SMTP_FROM || get("smtp_user") || process.env.SMTP_USER || "",
    siteName: get("site_name") || "TG Monitor Pro",
    siteUrl: get("site_url") || process.env.SITE_URL || "http://localhost:7000",
  };
}

// 创建 transporter
async function createTransporter() {
  const cfg = await getSmtpConfig();
  if (!cfg.host || !cfg.user || !cfg.pass) {
    throw new Error("SMTP 未配置，请在系统设置中填写 SMTP 信息");
  }
  return {
    transporter: nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: { user: cfg.user, pass: cfg.pass },
    }),
    cfg,
  };
}

// 发送邮箱验证邮件
export async function sendVerifyEmail(email: string, name: string, token: string) {
  const { transporter, cfg } = await createTransporter();
  const verifyUrl = `${cfg.siteUrl}/verify-email?token=${token}`;

  await transporter.sendMail({
    from: `"${cfg.siteName}" <${cfg.from}>`,
    to: email,
    subject: `【${cfg.siteName}】请验证您的邮箱`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0f172a;color:#e2e8f0;padding:32px;border-radius:12px;">
        <h2 style="color:#3b82f6;margin-bottom:8px;">验证您的邮箱</h2>
        <p>您好，${name || email}！</p>
        <p>感谢注册 <strong>${cfg.siteName}</strong>，请点击下方按钮验证您的邮箱地址：</p>
        <div style="text-align:center;margin:32px 0;">
          <a href="${verifyUrl}" style="background:#3b82f6;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-size:16px;font-weight:bold;">
            验证邮箱
          </a>
        </div>
        <p style="color:#94a3b8;font-size:13px;">链接有效期 24 小时。如非本人操作，请忽略此邮件。</p>
        <p style="color:#64748b;font-size:12px;">或复制以下链接到浏览器：<br/><a href="${verifyUrl}" style="color:#3b82f6;">${verifyUrl}</a></p>
      </div>
    `,
  });
}

// 发送密码重置邮件
export async function sendResetPasswordEmail(email: string, name: string, token: string) {
  const { transporter, cfg } = await createTransporter();
  const resetUrl = `${cfg.siteUrl}/reset-password?token=${token}`;

  await transporter.sendMail({
    from: `"${cfg.siteName}" <${cfg.from}>`,
    to: email,
    subject: `【${cfg.siteName}】重置您的密码`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0f172a;color:#e2e8f0;padding:32px;border-radius:12px;">
        <h2 style="color:#f59e0b;margin-bottom:8px;">重置密码</h2>
        <p>您好，${name || email}！</p>
        <p>我们收到了重置您 <strong>${cfg.siteName}</strong> 账号密码的请求，请点击下方按钮设置新密码：</p>
        <div style="text-align:center;margin:32px 0;">
          <a href="${resetUrl}" style="background:#f59e0b;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-size:16px;font-weight:bold;">
            重置密码
          </a>
        </div>
        <p style="color:#94a3b8;font-size:13px;">链接有效期 1 小时。如非本人操作，请忽略此邮件，您的账号安全无虞。</p>
        <p style="color:#64748b;font-size:12px;">或复制以下链接到浏览器：<br/><a href="${resetUrl}" style="color:#f59e0b;">${resetUrl}</a></p>
      </div>
    `,
  });
}

// 测试 SMTP 连接
export async function testSmtpConnection(): Promise<{ ok: boolean; error?: string }> {
  try {
    const { transporter } = await createTransporter();
    await transporter.verify();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}
