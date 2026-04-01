-- MySQL dump 10.13  Distrib 8.0.45, for Linux (x86_64)
--
-- Host: localhost    Database: tgmonitor
-- ------------------------------------------------------
-- Server version	8.0.45

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `system_config`
--

DROP TABLE IF EXISTS `system_config`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `system_config` (
  `id` int NOT NULL AUTO_INCREMENT,
  `configKey` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `configValue` text COLLATE utf8mb4_unicode_ci,
  `description` varchar(256) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `system_config_configKey_unique` (`configKey`)
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `system_config`
--

LOCK TABLES `system_config` WRITE;
/*!40000 ALTER TABLE `system_config` DISABLE KEYS */;
INSERT INTO `system_config` VALUES (1,'support_username','okami8888','客服 TG 用户名（不含@）','2026-03-21 02:47:49'),(2,'official_channel','https://t.me/RTDCI','官方频道链接（如 https://t.me/xxx）','2026-03-19 16:05:58'),(3,'tutorial_text','','使用教程内容（支持 Markdown）','2026-03-19 16:05:58'),(4,'bot_name','','Bot 显示名称','2026-03-19 16:05:58'),(5,'site_name','哨兵监听机器人','平台名称','2026-03-19 16:05:58'),(6,'anti_spam_enabled','true','anti_spam_enabled','2026-03-24 15:10:59'),(7,'anti_spam_daily_limit','','anti_spam_daily_limit','2026-03-21 02:55:20'),(8,'anti_spam_rate_window','','anti_spam_rate_window','2026-03-21 02:55:20'),(9,'anti_spam_rate_limit','','anti_spam_rate_limit','2026-03-21 02:55:20'),(10,'anti_spam_min_msg_len','','anti_spam_min_msg_len','2026-03-21 02:55:20'),(11,'global_filter_ads','true','全局广告过滤：true=开启，false=关闭','2026-03-24 15:10:59'),(12,'global_max_msg_length','6','全局消息字数上限：0=不限制，超过此字数的消息不推送','2026-03-24 15:10:59');
/*!40000 ALTER TABLE `system_config` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `plans`
--

DROP TABLE IF EXISTS `plans`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `plans` (
  `id` enum('free','basic','pro','enterprise') COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `price` decimal(10,2) NOT NULL,
  `maxMonitorGroups` int NOT NULL,
  `maxKeywords` int NOT NULL,
  `maxDailyDm` int NOT NULL,
  `maxTgAccounts` int NOT NULL,
  `maxTemplates` int NOT NULL,
  `features` json DEFAULT NULL,
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `plans`
--

LOCK TABLES `plans` WRITE;
/*!40000 ALTER TABLE `plans` DISABLE KEYS */;
INSERT INTO `plans` VALUES ('free','免费版',0.00,2,10,5,1,2,'[\"基础关键词匹配\", \"每日5条私信\"]',1,'2026-03-12 17:04:46'),('basic','基础版',29.00,10,50,30,3,5,'[\"精确/正则匹配\", \"每日30条私信\", \"命中记录7天\"]',1,'2026-03-12 17:04:46'),('pro','专业版',99.00,50,200,100,10,20,'[\"AND/OR/NOT逻辑\", \"每日100条私信\", \"命中记录30天\", \"防封策略配置\", \"模板轮换\"]',1,'2026-03-12 17:04:46'),('enterprise','企业版',299.00,200,1000,500,50,100,'[\"无限制功能\", \"每日500条私信\", \"命中记录90天\", \"账号池管理\", \"优先支持\"]',1,'2026-03-12 17:04:46');
/*!40000 ALTER TABLE `plans` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `bot_configs`
--

DROP TABLE IF EXISTS `bot_configs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bot_configs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `botToken` varchar(256) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `botUsername` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `notifyEnabled` tinyint(1) NOT NULL DEFAULT '1',
  `notifyTargetChatId` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `notifyFormat` enum('simple','standard','detailed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'standard',
  `isActive` tinyint(1) NOT NULL DEFAULT '0',
  `lastActiveAt` timestamp NULL DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `bot_configs_userId_unique` (`userId`),
  KEY `idx_bot_configs_userId` (`userId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `bot_configs`
--

LOCK TABLES `bot_configs` WRITE;
/*!40000 ALTER TABLE `bot_configs` DISABLE KEYS */;
/*!40000 ALTER TABLE `bot_configs` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `antiban_settings`
--

DROP TABLE IF EXISTS `antiban_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `antiban_settings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `dailyDmLimit` int NOT NULL DEFAULT '30',
  `minIntervalSeconds` int NOT NULL DEFAULT '60',
  `maxIntervalSeconds` int NOT NULL DEFAULT '180',
  `activeHourStart` int NOT NULL DEFAULT '9',
  `activeHourEnd` int NOT NULL DEFAULT '22',
  `deduplicateEnabled` tinyint(1) NOT NULL DEFAULT '1',
  `deduplicateWindowHours` int NOT NULL DEFAULT '24',
  `warningThreshold` int NOT NULL DEFAULT '70',
  `degradedThreshold` int NOT NULL DEFAULT '40',
  `suspendThreshold` int NOT NULL DEFAULT '20',
  `autoDegrade` tinyint(1) NOT NULL DEFAULT '1',
  `templateRotation` tinyint(1) NOT NULL DEFAULT '1',
  `dmEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `antiban_settings_userId_unique` (`userId`),
  KEY `idx_antiban_settings_userId` (`userId`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `antiban_settings`
--

LOCK TABLES `antiban_settings` WRITE;
/*!40000 ALTER TABLE `antiban_settings` DISABLE KEYS */;
INSERT INTO `antiban_settings` VALUES (1,2,5,60,180,9,22,1,24,70,40,20,1,1,0,'2026-03-21 18:09:09','2026-03-21 18:09:09');
/*!40000 ALTER TABLE `antiban_settings` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-04-01 18:09:07
