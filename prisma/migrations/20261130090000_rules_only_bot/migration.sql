-- Preserve historical records and live send markers. No new tables or grants.
UPDATE "AiJob" SET "status"='skipped', "claimToken"=NULL,
  "lastError"='ระบบใช้บอทตามกฎแล้ว', "updatedAt"=CURRENT_TIMESTAMP
WHERE "status" IN ('pending','running');
UPDATE "AiProvider" SET "enabled"=false, "updatedAt"=CURRENT_TIMESTAMP WHERE "enabled"=true;
UPDATE "Setting" SET "value"='rules',"updatedAt"=CURRENT_TIMESTAMP WHERE "key"='ai_provider';
-- Template rules no longer need a classification model. Keep scope and consent unchanged.
UPDATE "AutoCommentRule" SET "requireAi"=false, "revision"="revision"+1,"updatedAt"=CURRENT_TIMESTAMP
WHERE "deliveryMode"='extension' AND "messageMode"='template' AND "requireAi"=true;
-- A generated-message rule needs explicit owner-authored templates before it can run again.
UPDATE "AutoCommentRule" SET "enabled"=false, "pausedReason"='เลือกข้อความสำเร็จรูปก่อนเปิดกฎ ระบบนำ AI ออกแล้ว',
  "revision"="revision"+1,"updatedAt"=CURRENT_TIMESTAMP
WHERE "messageMode"='ai_draft';
-- Never modify dispatched/sending/uncertain jobs or historical live dedupe keys.
UPDATE "AutoCommentJob" j SET "status"='cancelled',"claimToken"=NULL,"claimUntil"=NULL,
  "lastError"='กฎเปลี่ยนเป็นบอทตามกฎ รอประเมินเงื่อนไขใหม่',"updatedAt"=CURRENT_TIMESTAMP
FROM "AutoCommentRule" r WHERE j."ruleId"=r."id"
  AND j."status" IN ('pending_ai','browser_ready','claimed') AND j."attempts"=0 AND j."dispatchedAt" IS NULL
  AND (j."ruleRevision"<>r."revision" OR r."messageMode"='ai_draft');
UPDATE "AutoCommentEvaluation" SET "nextEvaluateAt"=CURRENT_TIMESTAMP
WHERE "state"='waiting_ai';
