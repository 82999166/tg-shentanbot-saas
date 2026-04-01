# 数据库备份说明

## 文件说明

- `schema.sql` - 完整数据库结构（不含用户数据）
- `config_data.sql` - 关键配置表数据（system_config / plans / bot_configs / antiban_settings）

## 恢复方法

```bash
# 恢复结构
mysql -u tgmonitor -p tgmonitor < schema.sql

# 恢复配置数据
mysql -u tgmonitor -p tgmonitor < config_data.sql
```

## 注意事项

- 用户数据（users / tg_accounts / keywords 等）因含隐私信息，不纳入版本控制
- 如需完整数据迁移，请在服务器上执行完整 mysqldump
