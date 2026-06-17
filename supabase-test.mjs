import { enabled } from './supabase.mjs';
import * as sb from './supabase.mjs';
if(!enabled){ console.log('SUPABASE_URL / SUPABASE_SERVICE_ROLE not set in .env — add them first.'); process.exit(1); }
const uid='__healthcheck__';
try{
  await sb.setProfile(uid,{ full_name:'Health Check', email:'health@check' });
  const p=await sb.getProfile(uid);
  await sb.addRows(uid,[{url:'https://example.com/hc',source:'test',title:'T',company:'C',location:'San Francisco, CA'}],'2026-01-01');
  const rows=await sb.getRows(uid);
  console.log('✅ Supabase connected. profile.full_name =', p.full_name, '| jobs rows for healthcheck =', rows.length);
  console.log('   (you can delete the __healthcheck__ rows in the table editor)');
}catch(e){ console.error('❌ Supabase test failed:', e.message); process.exit(1); }
