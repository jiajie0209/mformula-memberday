-- MFormula Member Day — Cloudflare D1 数据库结构
-- 在 Cloudflare D1 控制台执行一次(建表)

-- 通用键值(config / 哨兵 等存 JSON)
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);

-- 会员账本(乐观锁 version 防并发双花)
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  ordered INTEGER NOT NULL DEFAULT 0,   -- 1 = 已下单(导出名单用)
  played INTEGER NOT NULL DEFAULT 0     -- 1 = 玩过(抽过/有奖)
);

-- 统计(单行,原子自增,扛并发)
CREATE TABLE IF NOT EXISTS stats (
  id INTEGER PRIMARY KEY,
  participants INTEGER NOT NULL DEFAULT 0,
  spins INTEGER NOT NULL DEFAULT 0,
  orders INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS prize_counts (k TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS winners (id TEXT PRIMARY KEY, name TEXT, n INTEGER NOT NULL DEFAULT 0);

-- 限量库存 + 999金哨兵
CREATE TABLE IF NOT EXISTS stock (k TEXT PRIMARY KEY, qty INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sentinels (k TEXT PRIMARY KEY);

-- 下单记录(客服核对)
CREATE TABLE IF NOT EXISTS redemptions (code TEXT PRIMARY KEY, data TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'issued');
