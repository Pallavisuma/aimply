/**
 * location.mjs — decide whether a job location is in the United States.
 *
 * Heuristic (intentionally conservative): a location is allowed if it
 * shows a US signal (US/USA/United States, a US state name or 2-letter
 * code, "Remote - US"), OR it's a bare "Remote" with no foreign marker.
 * It is rejected if it names a non-US country or a well-known non-US city.
 * Blank/unknown locations are allowed by default (can't prove foreign),
 * so set strict:true to drop those too.
 */

const US_STATES = ['alabama','alaska','arizona','arkansas','california','colorado','connecticut','delaware','florida','georgia','hawaii','idaho','illinois','indiana','iowa','kansas','kentucky','louisiana','maine','maryland','massachusetts','michigan','minnesota','mississippi','missouri','montana','nebraska','nevada','new hampshire','new jersey','new mexico','new york','north carolina','north dakota','ohio','oklahoma','oregon','pennsylvania','rhode island','south carolina','south dakota','tennessee','texas','utah','vermont','virginia','washington','west virginia','wisconsin','wyoming','district of columbia'];
const US_CITIES = ['san francisco','san jose','silicon valley','bay area','palo alto','mountain view','sunnyvale','santa clara','menlo park','cupertino','oakland','los angeles','san diego','sacramento','seattle','bellevue','redmond','portland','new york','nyc','manhattan','brooklyn','boston','cambridge','austin','dallas','houston','san antonio','chicago','denver','boulder','atlanta','miami','orlando','tampa','phoenix','scottsdale','las vegas','salt lake city','minneapolis','detroit','pittsburgh','philadelphia','washington dc','arlington','reston','raleigh','durham','charlotte','nashville','columbus','indianapolis','kansas city','st louis','san mateo','irvine','san bruno','culver city','santa monica','plano','remote us','us remote'];
const US_ABBR = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'];

// Non-US countries + a few high-frequency non-US cities seen in ATS data.
const FOREIGN = ['united kingdom','england','scotland','wales','ireland','germany','france','spain','portugal','italy','netherlands','belgium','switzerland','austria','sweden','norway','denmark','finland','poland','czech','romania','hungary','greece','turkey','israel','india','china','japan','korea','singapore','malaysia','indonesia','thailand','vietnam','philippines','australia','new zealand','canada','mexico','brazil','argentina','chile','colombia','south africa','nigeria','egypt','uae','dubai','abu dhabi','qatar','saudi',
  'london','berlin','munich','hamburg','frankfurt','paris','madrid','barcelona','lisbon','amsterdam','dublin','milan','rome','zurich','vienna','stockholm','oslo','copenhagen','helsinki','warsaw','prague','toronto','vancouver','montreal','bangalore','bengaluru','hyderabad','mumbai','delhi','pune','chennai','tel aviv','sydney','melbourne','sao paulo','mexico city','singapore','riyadh','jeddah','dubai','abu dhabi','doha','kuwait','manama','muscat','amman','beirut','cairo','istanbul','middle east','emea','apac'];

function hasWordCode(text, codes) {
  for (const c of codes) {
    const re = new RegExp(`(^|[,\\s(/])${c}([,\\s)/]|$)`);
    if (re.test(text)) return true;
  }
  return false;
}

export function isUSLocation(location, opts = {}) {
  const strict = !!opts.strict;
  const raw = (location || '').trim();
  if (!raw) return !strict;               // unknown -> allow unless strict
  const l = raw.toLowerCase();

  const foreign = FOREIGN.some(f => l.includes(f));
  const usText = /\b(u\.?s\.?a?|united states|usa)\b/.test(l) || US_STATES.some(x => l.includes(x)) || US_CITIES.some(x => l.includes(x)) || hasWordCode(raw, US_ABBR);
  const remote = /\bremote\b/.test(l) || /\banywhere\b/.test(l);

  if (foreign && !usText) return false;   // explicitly foreign
  if (usText) return true;                // explicitly US
  if (remote) return true;                // bare remote -> allow
  return !strict;                         // ambiguous -> allow unless strict
}
