require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
async function main() {
  const since = new Date(Date.now()-24*3600000);
  const runs = await db.scrapeRun.findMany({where:{createdAt:{gte:since}},select:{createdAt:true,extVersion:true,ok:true,stoppedBy:true,found:true,fresh:true,inserted:true,scrolls:true,hitLimit:true,stalls:true,durationMs:true,reloaded:true,throttled:true}});
  const groups = {};
  for(const r of runs){const key=r.extVersion+':'+r.stoppedBy; const g=groups[key] ||= {runs:0,found:0,fresh:0,inserted:0,durationMs:0,stalls:0,errors:0};g.runs++;for(const k of ['found','fresh','inserted','durationMs','stalls'])g[k]+=r[k];if(!r.ok)g.errors++;}
  const sources=await db.source.findMany({where:{enabled:true,type:{in:['facebook_group','facebook_marketplace']}},select:{nextRunAt:true,lastFetchedAt:true,lastRunStop:true}});
  console.log(JSON.stringify({since,now:new Date(),runs24h:runs.length,groups,sources:{enabled:sources.length,neverFetched:sources.filter(s=>!s.lastFetchedAt).length,overdue:sources.filter(s=>!s.nextRunAt||s.nextRunAt<new Date()).length},latestRun:runs.map(r=>r.createdAt).sort().at(-1)},null,2));
}
main().catch(e=>{console.error('Audit failed:',e.code||e.name);process.exitCode=1;}).finally(()=>db.$disconnect());
