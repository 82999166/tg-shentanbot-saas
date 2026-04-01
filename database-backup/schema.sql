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
-- Table structure for table `__drizzle_migrations`
--

DROP TABLE IF EXISTS `__drizzle_migrations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `__drizzle_migrations` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `hash` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` bigint DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `id` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

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
-- Table structure for table `blacklist`
--

DROP TABLE IF EXISTS `blacklist`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `blacklist` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `targetTgId` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `targetUsername` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reason` text COLLATE utf8mb4_unicode_ci,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  KEY `idx_blacklist_userId` (`userId`),
  KEY `idx_blacklist_targetTgId` (`targetTgId`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

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
-- Table structure for table `dm_queue`
--

DROP TABLE IF EXISTS `dm_queue`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `dm_queue` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `hitRecordId` bigint DEFAULT NULL,
  `senderAccountId` int NOT NULL,
  `targetTgId` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `targetUsername` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `templateId` int DEFAULT NULL,
  `content` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `scheduledAt` timestamp NOT NULL,
  `status` enum('pending','processing','sent','failed','cancelled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `retryCount` int NOT NULL DEFAULT '0',
  `maxRetries` int NOT NULL DEFAULT '3',
  `sentAt` timestamp NULL DEFAULT NULL,
  `errorMessage` text COLLATE utf8mb4_unicode_ci,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_dm_queue_userId` (`userId`),
  KEY `idx_dm_queue_status` (`status`),
  KEY `idx_dm_queue_scheduledAt` (`scheduledAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `group_submissions`
--

DROP TABLE IF EXISTS `group_submissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `group_submissions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `groupLink` varchar(256) COLLATE utf8mb4_unicode_ci NOT NULL,
  `groupTitle` varchar(256) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `status` enum('pending','approved','rejected') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `reviewNote` text COLLATE utf8mb4_unicode_ci,
  `reviewedAt` timestamp NULL DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_group_submissions_userId` (`userId`),
  KEY `idx_group_submissions_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `hit_records`
--

DROP TABLE IF EXISTS `hit_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `hit_records` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `monitorGroupId` int NOT NULL,
  `keywordId` int NOT NULL,
  `tgAccountId` int NOT NULL,
  `messageId` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `messageContent` text COLLATE utf8mb4_unicode_ci,
  `messageDate` timestamp NULL DEFAULT NULL,
  `senderTgId` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `senderUsername` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `senderFirstName` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `senderLastName` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `matchedKeyword` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `dmStatus` enum('pending','queued','sent','failed','skipped','duplicate') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `dmSentAt` timestamp NULL DEFAULT NULL,
  `dmTemplateId` int DEFAULT NULL,
  `dmContent` text COLLATE utf8mb4_unicode_ci,
  `dmError` text COLLATE utf8mb4_unicode_ci,
  `isProcessed` tinyint(1) NOT NULL DEFAULT '0',
  `processedAt` timestamp NULL DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  KEY `idx_hit_records_userId` (`userId`),
  KEY `idx_hit_records_monitorGroupId` (`monitorGroupId`),
  KEY `idx_hit_records_keywordId` (`keywordId`),
  KEY `idx_hit_records_senderTgId` (`senderTgId`),
  KEY `idx_hit_records_createdAt` (`createdAt`)
) ENGINE=InnoDB AUTO_INCREMENT=608 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `invite_codes`
--

DROP TABLE IF EXISTS `invite_codes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `invite_codes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `code` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `totalInvited` int NOT NULL DEFAULT '0',
  `totalPaidInvited` int NOT NULL DEFAULT '0',
  `totalRewardDays` int NOT NULL DEFAULT '0',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `invite_codes_userId_unique` (`userId`),
  UNIQUE KEY `invite_codes_code_unique` (`code`),
  KEY `idx_invite_codes_userId` (`userId`),
  KEY `idx_invite_codes_code` (`code`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `invite_records`
--

DROP TABLE IF EXISTS `invite_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `invite_records` (
  `id` int NOT NULL AUTO_INCREMENT,
  `inviterId` int NOT NULL,
  `inviteeId` int NOT NULL,
  `inviteCode` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `registrationRewarded` tinyint(1) NOT NULL DEFAULT '0',
  `paymentRewarded` tinyint(1) NOT NULL DEFAULT '0',
  `rewardDaysGranted` int NOT NULL DEFAULT '0',
  `registeredAt` timestamp NOT NULL DEFAULT (now()),
  `paidAt` timestamp NULL DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `invite_records_inviteeId_unique` (`inviteeId`),
  KEY `idx_invite_records_inviterId` (`inviterId`),
  KEY `idx_invite_records_inviteeId` (`inviteeId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `keyword_daily_stats`
--

DROP TABLE IF EXISTS `keyword_daily_stats`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `keyword_daily_stats` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `keywordId` int NOT NULL,
  `date` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `hitCount` int NOT NULL DEFAULT '0',
  `uniqueSenders` int NOT NULL DEFAULT '0',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_kds_userId` (`userId`),
  KEY `idx_kds_keywordId` (`keywordId`),
  KEY `idx_kds_date` (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `keyword_groups`
--

DROP TABLE IF EXISTS `keyword_groups`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `keyword_groups` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `color` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT '#3B82F6',
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_keyword_groups_userId` (`userId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `keywords`
--

DROP TABLE IF EXISTS `keywords`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `keywords` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `groupId` int DEFAULT NULL,
  `keyword` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL,
  `matchType` enum('exact','contains','regex','and','or','not') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'contains',
  `subKeywords` json DEFAULT NULL,
  `caseSensitive` tinyint(1) NOT NULL DEFAULT '0',
  `hitCount` int NOT NULL DEFAULT '0',
  `lastHitAt` timestamp NULL DEFAULT NULL,
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_keywords_userId` (`userId`),
  KEY `idx_keywords_groupId` (`groupId`)
) ENGINE=InnoDB AUTO_INCREMENT=49 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `login_attempts`
--

DROP TABLE IF EXISTS `login_attempts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `login_attempts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `email` varchar(320) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ip` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `success` tinyint(1) NOT NULL DEFAULT '0',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  KEY `idx_la_email` (`email`),
  KEY `idx_la_ip` (`ip`)
) ENGINE=InnoDB AUTO_INCREMENT=42 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `message_templates`
--

DROP TABLE IF EXISTS `message_templates`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `message_templates` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `content` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `weight` int NOT NULL DEFAULT '1',
  `usedCount` int NOT NULL DEFAULT '0',
  `lastUsedAt` timestamp NULL DEFAULT NULL,
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_message_templates_userId` (`userId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `monitor_groups`
--

DROP TABLE IF EXISTS `monitor_groups`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `monitor_groups` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `tgAccountId` int NOT NULL,
  `groupId` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `groupTitle` varchar(256) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `groupUsername` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `groupType` enum('group','supergroup','channel') COLLATE utf8mb4_unicode_ci DEFAULT 'supergroup',
  `memberCount` int DEFAULT NULL,
  `keywordIds` json DEFAULT NULL,
  `monitorStatus` enum('active','paused','error') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `lastMessageAt` timestamp NULL DEFAULT NULL,
  `totalHits` int NOT NULL DEFAULT '0',
  `errorMessage` text COLLATE utf8mb4_unicode_ci,
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_monitor_groups_user_group` (`userId`,`groupId`),
  KEY `idx_monitor_groups_userId` (`userId`),
  KEY `idx_monitor_groups_tgAccountId` (`tgAccountId`)
) ENGINE=InnoDB AUTO_INCREMENT=195 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `password_reset_tokens`
--

DROP TABLE IF EXISTS `password_reset_tokens`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `password_reset_tokens` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `token` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `expiresAt` timestamp NOT NULL,
  `usedAt` timestamp NULL DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `password_reset_tokens_token_unique` (`token`),
  KEY `idx_prt_userId` (`userId`),
  KEY `idx_prt_token` (`token`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `payment_orders`
--

DROP TABLE IF EXISTS `payment_orders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payment_orders` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `planId` enum('basic','pro','enterprise') COLLATE utf8mb4_unicode_ci NOT NULL,
  `durationMonths` int NOT NULL DEFAULT '1',
  `usdtAmount` decimal(18,6) NOT NULL,
  `usdtAddress` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `network` enum('trc20','erc20','bep20') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'trc20',
  `txHash` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `confirmedAt` timestamp NULL DEFAULT NULL,
  `status` enum('pending','confirming','completed','expired','failed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `expiredAt` timestamp NOT NULL,
  `redeemCode` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_payment_orders_userId` (`userId`),
  KEY `idx_payment_orders_status` (`status`),
  KEY `idx_payment_orders_usdtAmount` (`usdtAmount`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

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
-- Table structure for table `public_group_join_status`
--

DROP TABLE IF EXISTS `public_group_join_status`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `public_group_join_status` (
  `id` int NOT NULL AUTO_INCREMENT,
  `publicGroupId` int NOT NULL,
  `monitorAccountId` int NOT NULL,
  `status` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `errorMsg` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `joinedAt` timestamp NULL DEFAULT NULL,
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_pgjs_unique` (`publicGroupId`,`monitorAccountId`),
  KEY `idx_pgjs_groupId` (`publicGroupId`),
  KEY `idx_pgjs_accountId` (`monitorAccountId`)
) ENGINE=InnoDB AUTO_INCREMENT=205 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `public_group_keywords`
--

DROP TABLE IF EXISTS `public_group_keywords`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `public_group_keywords` (
  `id` int NOT NULL AUTO_INCREMENT,
  `publicGroupId` int NOT NULL,
  `pattern` varchar(256) COLLATE utf8mb4_unicode_ci NOT NULL,
  `matchType` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT 'contains',
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  KEY `idx_pgk_groupId` (`publicGroupId`),
  KEY `idx_pgk_isActive` (`isActive`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `public_monitor_groups`
--

DROP TABLE IF EXISTS `public_monitor_groups`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `public_monitor_groups` (
  `id` int NOT NULL AUTO_INCREMENT,
  `groupId` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `groupTitle` varchar(256) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `groupType` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT 'group',
  `memberCount` int DEFAULT '0',
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `addedBy` int DEFAULT NULL,
  `note` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `public_monitor_groups_groupId_unique` (`groupId`),
  KEY `idx_pmg_groupId` (`groupId`),
  KEY `idx_pmg_isActive` (`isActive`)
) ENGINE=InnoDB AUTO_INCREMENT=416 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `push_settings`
--

DROP TABLE IF EXISTS `push_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `push_settings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `pushEnabled` tinyint(1) NOT NULL DEFAULT '1',
  `filterAds` tinyint(1) NOT NULL DEFAULT '0',
  `maxMsgLength` int NOT NULL DEFAULT '0',
  `collaborationGroupId` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `collaborationGroupTitle` varchar(256) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pushFormat` enum('simple','standard','detailed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'standard',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `push_settings_userId_unique` (`userId`),
  KEY `idx_push_settings_userId` (`userId`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `redeem_codes`
--

DROP TABLE IF EXISTS `redeem_codes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `redeem_codes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `code` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `planId` enum('basic','pro','enterprise') COLLATE utf8mb4_unicode_ci NOT NULL,
  `durationMonths` int NOT NULL DEFAULT '1',
  `status` enum('unused','used','expired') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'unused',
  `usedByUserId` int DEFAULT NULL,
  `usedAt` timestamp NULL DEFAULT NULL,
  `orderId` int DEFAULT NULL,
  `batchId` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `expiresAt` timestamp NULL DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `redeem_codes_code_unique` (`code`),
  KEY `idx_redeem_codes_code` (`code`),
  KEY `idx_redeem_codes_status` (`status`),
  KEY `idx_redeem_codes_orderId` (`orderId`)
) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sender_history`
--

DROP TABLE IF EXISTS `sender_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sender_history` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `senderTgId` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `senderUsername` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `senderFirstName` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `messageContent` text COLLATE utf8mb4_unicode_ci,
  `groupId` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `groupTitle` varchar(256) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `messageDate` timestamp NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  KEY `idx_sender_history_userId` (`userId`),
  KEY `idx_sender_history_senderTgId` (`senderTgId`),
  KEY `idx_sender_history_messageDate` (`messageDate`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

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
-- Table structure for table `system_settings`
--

DROP TABLE IF EXISTS `system_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `system_settings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `key` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `value` text COLLATE utf8mb4_unicode_ci,
  `description` text COLLATE utf8mb4_unicode_ci,
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `system_settings_key_unique` (`key`)
) ENGINE=InnoDB AUTO_INCREMENT=37 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tg_accounts`
--

DROP TABLE IF EXISTS `tg_accounts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tg_accounts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `phone` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tgUserId` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tgUsername` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tgFirstName` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tgLastName` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sessionString` text COLLATE utf8mb4_unicode_ci,
  `sessionStatus` enum('pending','active','expired','banned') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `accountRole` enum('monitor','sender','both') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'both',
  `healthScore` int NOT NULL DEFAULT '100',
  `healthStatus` enum('healthy','warning','degraded','suspended') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'healthy',
  `totalMonitored` int NOT NULL DEFAULT '0',
  `totalDmSent` int NOT NULL DEFAULT '0',
  `dailyDmSent` int NOT NULL DEFAULT '0',
  `dailyDmResetAt` timestamp NULL DEFAULT NULL,
  `lastActiveAt` timestamp NULL DEFAULT NULL,
  `proxyHost` varchar(256) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `proxyPort` int DEFAULT NULL,
  `proxyType` enum('socks5','http','mtproto') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `proxyUsername` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `proxyPassword` varchar(256) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  `last_alert_at` bigint DEFAULT NULL,
  `lastAlertAt` timestamp NULL DEFAULT NULL,
  `isPublicAccount` tinyint(1) NOT NULL DEFAULT '0' COMMENT '公共监控账号',
  `maxGroupsPerAccount` int DEFAULT '20' COMMENT '单账号最大群组数',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tg_accounts_phone` (`phone`),
  KEY `idx_tg_accounts_userId` (`userId`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `openId` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` text COLLATE utf8mb4_unicode_ci,
  `email` varchar(320) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `loginMethod` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `role` enum('user','admin') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'user',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  `lastSignedIn` timestamp NOT NULL DEFAULT (now()),
  `planId` enum('free','basic','pro','enterprise') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'free',
  `planExpiresAt` timestamp NULL DEFAULT NULL,
  `dailyDmSent` int NOT NULL DEFAULT '0',
  `dailyDmResetAt` timestamp NULL DEFAULT NULL,
  `passwordHash` varchar(256) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `emailVerified` tinyint(1) NOT NULL DEFAULT '0',
  `emailVerifyToken` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `emailVerifyExpiry` timestamp NULL DEFAULT NULL,
  `tgUserId` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tgUsername` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tgFirstName` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `users_openId_unique` (`openId`),
  UNIQUE KEY `users_email_unique` (`email`),
  UNIQUE KEY `users_tgUserId_unique` (`tgUserId`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-04-01 18:09:07
