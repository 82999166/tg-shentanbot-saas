/**
 * cleanup.ts - 定时清理任务
 * 每天凌晨 3 点自动清理过期的命中记录、关键词统计等数据
 * 保留天数由管理员在系统设置中配置（data_retention_days，0=永久保留）
 */
import { getDb } from "../db";
import { systemConfig, hitRecords, keywordDailyStats } from "../../drizzle/schema";
import { lt, eq, sql } from "drizzle-orm";

async function getRetentionDays(): Promise<number> {
  try {
    const db = await getDb();
    if (!db) return 0;
    const row = await db
      .select()
      .from(systemConfig)
      .where(eq(systemConfig.configKey, "data_retention_days"))
      .limit(1);
    const val = parseInt(row[0]?.configValue || "0", 10);
    return isNaN(val) ? 0 : val;
  } catch {
    return 0;
  }
}

export async function runCleanup() {
  const retentionDays = await getRetentionDays();
  if (retentionDays <= 0) {
    console.log("[Cleanup] data_retention_days=0，跳过清理（永久保留）");
    return;
  }
  const db = await getDb();
  if (!db) return;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);

  try {
    // 清理命中记录
    const hitResult = await db
      .delete(hitRecords)
      .where(lt(hitRecords.createdAt, cutoff));
    console.log(`[Cleanup] 清理命中记录: ${(hitResult as any)[0]?.affectedRows ?? 0} 条（${retentionDays}天前）`);
  } catch (e) {
    console.error("[Cleanup] 清理命中记录失败:", e);
  }

  try {
    // 清理关键词日统计（保留最近 N 天）
    const cutoffDateStr = cutoff.toISOString().split("T")[0];
    const statsResult = await db
      .delete(keywordDailyStats)
      .where(lt(keywordDailyStats.date, cutoffDateStr));
    console.log(`[Cleanup] 清理关键词统计: ${(statsResult as any)[0]?.affectedRows ?? 0} 条`);
  } catch (e) {
    // keywordDailyStats 表可能不存在，忽略错误
    console.log("[Cleanup] 关键词统计清理跳过（表不存在或无数据）");
  }

  console.log(`[Cleanup] 定时清理完成，保留最近 ${retentionDays} 天数据`);
}

export function startCleanupScheduler() {
  // 立即执行一次（服务启动时检查）
  runCleanup().catch(console.error);

  // 每天凌晨 3 点执行（通过 setInterval 每小时检查一次，命中 3 点时执行）
  let lastCleanupDate = "";
  setInterval(() => {
    const now = new Date();
    const hour = now.getHours();
    const dateStr = now.toISOString().split("T")[0];
    if (hour === 3 && dateStr !== lastCleanupDate) {
      lastCleanupDate = dateStr;
      console.log(`[Cleanup] 凌晨 3 点定时清理触发: ${dateStr}`);
      runCleanup().catch(console.error);
    }
  }, 60 * 60 * 1000); // 每小时检查一次
}
