/* ============================================================
   Board content: leagues, teams, and scoring rules.
   This is the file to edit when adding/removing a team or league
   — everything else in js/ just reads from these objects.
   ============================================================ */

// The 10 people in the fantasy draft. Every team in TEAM_META
// belongs to exactly one of these via its draftTeamId field.
export const DRAFT_TEAMS = [
  { id:'josh', name:'Josh' },
  { id:'isaac', name:'Isaac' },
  { id:'drew', name:'Drew' },
  { id:'douglas', name:'Douglas' },
  { id:'collin', name:'Collin' },
  { id:'erichylok', name:'Eric Hylok' },
  { id:'patrick', name:'Patrick' },
  { id:'peter', name:'Peter' },
  { id:'ericprister', name:'Eric Prister' },
  { id:'donny', name:'Donny' }
];

// Static look/labels for every team, plus (where available) its
// TheSportsDB team ID so we can pull live results. Teams with
// sportsdbId: null don't have reliable live coverage yet (see
// College Basketball below) and fall back to a plain notice.
// rundownTeamId (TheRundown's team ID, matched against the sport_id
// in RUNDOWN_SPORT_ID for the team's leagueKey — see js/api.js) adds
// live in-game state on top of sportsdbId where present, or — for
// College Basketball, which TheSportsDB doesn't carry — is the only
// live source at all.
// leagueKey links each team to its LEAGUE_SCORING entry below.
// draftTeamId links each team to its owner in DRAFT_TEAMS above.
//
// Josh's 21 teams and all 18 other EPL clubs (below) have full
// metadata (real badge colors, live sportsdbId/rundownTeamId) filled
// in. The remaining 171 teams — one roster per drafter, pulled from
// the shared draft spreadsheet, across NFL/NBA/NHL/MLB/WNBA/CFB/CBB —
// are appended further down as a skeleton: correct name/league/owner,
// a league-colored placeholder badge, and no live data yet. Fill
// those in incrementally the same way EPL was done, league by league.
export const TEAM_META = {
  liverpool:  { name:'Liverpool',   leagueKey:'epl',  draftTeamId:'josh', boardSub:'Premier League', sub:"Premier League · '26/'27 Season", accent:'#C8102E', badgeStyle:'background:#C8102E; color:#F6EB61;', badgeText:'LFC',  sportsdbId:'133602', leagueId:'4328', season:'2026-2027', rundownTeamId:3446, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/kfaher1737969724.png' },
  newcastle:  { name:'Newcastle',   leagueKey:'epl',  draftTeamId:'josh', boardSub:'Premier League', sub:"Premier League · '26/'27 Season", accent:'#241F20', badgeStyle:'background:#241F20; color:#FFFFFF;', badgeText:'NUFC', sportsdbId:'134777', leagueId:'4328', season:'2026-2027', rundownTeamId:3449, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/lhwuiz1621593302.png' },

  lions:      { name:'Lions',       leagueKey:'nfl',  draftTeamId:'josh', boardSub:'Detroit',     sub:"NFL · Detroit · '26 Season",     accent:'#0076B6', badgeStyle:'background:#0076B6; color:#B0B7BC;', badgeText:'DET',  sportsdbId:'134939', rundownTeamId:82, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/lgsgkr1546168257.png' },
  steelers:   { name:'Steelers',    leagueKey:'nfl',  draftTeamId:'josh', boardSub:'Pittsburgh',  sub:"NFL · Pittsburgh · '26 Season",  accent:'#101820', badgeStyle:'background:#101820; color:#FFB612;', badgeText:'PIT',  sportsdbId:'134925', rundownTeamId:68, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/2975411515853129.png' },
  dolphins:   { name:'Dolphins',    leagueKey:'nfl',  draftTeamId:'josh', boardSub:'Miami',       sub:"NFL · Miami · '26 Season",       accent:'#008E97', badgeStyle:'background:#008E97; color:#F58220;', badgeText:'MIA',  sportsdbId:'134919', rundownTeamId:62, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/e803xt1784722221.png' },

  cavaliers:  { name:'Cavaliers',   leagueKey:'nba',  draftTeamId:'josh', boardSub:'Cleveland',   sub:"NBA · Cleveland · '26/'27 Season", accent:'#860038', badgeStyle:'background:#860038; color:#FDBB30;', badgeText:'CLE',  sportsdbId:'134871', rundownTeamId:7 },
  nuggets:    { name:'Nuggets',     leagueKey:'nba',  draftTeamId:'josh', boardSub:'Denver',      sub:"NBA · Denver · '26/'27 Season",   accent:'#0E2240', badgeStyle:'background:#0E2240; color:#FEC524;', badgeText:'DEN',  sportsdbId:'134885', rundownTeamId:16 },
  mavericks:  { name:'Mavericks',   leagueKey:'nba',  draftTeamId:'josh', boardSub:'Dallas',      sub:"NBA · Dallas · '26/'27 Season",   accent:'#00538C', badgeStyle:'background:#00538C; color:#B8C4CA;', badgeText:'DAL',  sportsdbId:'134875', rundownTeamId:26 },

  lightning:  { name:'Lightning',   leagueKey:'nhl',  draftTeamId:'josh', boardSub:'Tampa Bay',   sub:"NHL · Tampa Bay · '26/'27 Season", accent:'#002868', badgeStyle:'background:#002868; color:#FFFFFF;', badgeText:'TBL',  sportsdbId:'134836', rundownTeamId:105 },
  flyers:     { name:'Flyers',      leagueKey:'nhl',  draftTeamId:'josh', boardSub:'Philadelphia', sub:"NHL · Philadelphia · '26/'27 Season", accent:'#F74902', badgeStyle:'background:#F74902; color:#000000;', badgeText:'PHI',  sportsdbId:'134843', rundownTeamId:96 },
  redwings:   { name:'Red Wings',   leagueKey:'nhl',  draftTeamId:'josh', boardSub:'Detroit',     sub:"NHL · Detroit · '26/'27 Season",  accent:'#CE1126', badgeStyle:'background:#CE1126; color:#FFFFFF;', badgeText:'DET',  sportsdbId:'134832', rundownTeamId:110 },

  cubs:       { name:'Cubs',        leagueKey:'mlb',  draftTeamId:'josh', boardSub:'Chicago',     sub:"MLB · Chicago · '27 Season",      accent:'#0E3386', badgeStyle:'background:#0E3386; color:#CC3433;', badgeText:'CHC',  sportsdbId:'135269', rundownTeamId:36 },
  padres:     { name:'Padres',      leagueKey:'mlb',  draftTeamId:'josh', boardSub:'San Diego',   sub:"MLB · San Diego · '27 Season",    accent:'#2F241D', badgeStyle:'background:#2F241D; color:#FFC425;', badgeText:'SD',   sportsdbId:'135278', rundownTeamId:44 },
  nationals:  { name:'Nationals',   leagueKey:'mlb',  draftTeamId:'josh', boardSub:'Washington',  sub:"MLB · Washington · '27 Season",   accent:'#AB0003', badgeStyle:'background:#AB0003; color:#FFFFFF;', badgeText:'WSH',  sportsdbId:'135281', rundownTeamId:35 },

  valkyries:  { name:'Valkyries',   leagueKey:'wnba', draftTeamId:'josh', boardSub:'Golden State', sub:"WNBA · Golden State · '27 Season", accent:'#8A6BAF', badgeStyle:'background:#000000; color:#8A6BAF;', badgeText:'GSV',  sportsdbId:'150722', rundownTeamId:10982 },

  oregon:     { name:'Oregon',      leagueKey:'cfb',  draftTeamId:'josh', boardSub:'Ducks',       sub:"College Football · '26 Season",  accent:'#154733', badgeStyle:'background:#154733; color:#FEE123;', badgeText:'ORE',  sportsdbId:'136938', recentLabel:'Results So Far', rundownTeamId:198, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/p7qmdy1564336566.png' },
  texasam:    { name:'Texas A&M',   leagueKey:'cfb',  draftTeamId:'josh', boardSub:'Aggies',      sub:"College Football · '26 Season",  accent:'#500000', badgeStyle:'background:#500000; color:#FFFFFF;', badgeText:'A&M',  sportsdbId:'136959', recentLabel:'Results So Far', rundownTeamId:218, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/tsu3lj1564336806.png' },
  arizona:    { name:'Arizona',     leagueKey:'cfb',  draftTeamId:'josh', boardSub:'Wildcats',    sub:"College Football · '26 Season",  accent:'#AB0520', badgeStyle:'background:#AB0520; color:#0C234B;', badgeText:'ARIZ', sportsdbId:'136171', recentLabel:'Results So Far', rundownTeamId:125, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/kq29h81564335468.png' },

  // TheSportsDB doesn't carry a distinct entry for these three
  // schools' basketball programs (only their football teams), so
  // sportsdbId stays null — TheRundown (rundownTeamId, sport_id 5)
  // is their only live source, not just a live-state supplement.
  houston:    { name:'Houston',     leagueKey:'mcbb', draftTeamId:'josh', boardSub:'Cougars',      sub:'College Basketball · Cougars',      accent:'#C8102E', badgeStyle:'background:#C8102E; color:#FFFFFF;', badgeText:'HOU', sportsdbId:null, rundownTeamId:275 },
  purdue:     { name:'Purdue',      leagueKey:'mcbb', draftTeamId:'josh', boardSub:'Boilermakers', sub:'College Basketball · Boilermakers', accent:'#000000', badgeStyle:'background:#000000; color:#CEB888;', badgeText:'PUR', sportsdbId:null, rundownTeamId:321 },
  utahstate:  { name:'Utah State',  leagueKey:'mcbb', draftTeamId:'josh', boardSub:'Aggies',       sub:'College Basketball · Aggies',       accent:'#0F2439', badgeStyle:'background:#0F2439; color:#FFFFFF;', badgeText:'USU', sportsdbId:null, rundownTeamId:348 },

  // ---- Skeleton: the other 9 drafters' rosters (189 teams) ----
  isaac_arsenal: { name:'Arsenal', leagueKey:'epl', draftTeamId:'isaac', boardSub:'Premier League', sub:"Premier League · '26/'27 Season", accent:'#EF0107', badgeStyle:'background:#EF0107; color:#FFFFFF;', badgeText:'ARS', sportsdbId:'133604', leagueId:'4328', season:'2026-2027', rundownTeamId:3436, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/uyhbfe1612467038.png' },
  drew_mancity: { name:'Man City', leagueKey:'epl', draftTeamId:'drew', boardSub:'Premier League', sub:"Premier League · '26/'27 Season", accent:'#6CABDD', badgeStyle:'background:#6CABDD; color:#1C2C5B;', badgeText:'MC', sportsdbId:'133613', leagueId:'4328', season:'2026-2027', rundownTeamId:3447, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/vwpvry1467462651.png' },
  douglas_everton: { name:'Everton', leagueKey:'epl', draftTeamId:'douglas', boardSub:'Premier League', sub:"Premier League · '26/'27 Season", accent:'#003399', badgeStyle:'background:#003399; color:#FFFFFF;', badgeText:'EVE', sportsdbId:'133615', leagueId:'4328', season:'2026-2027', rundownTeamId:3442, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/eqayrf1523184794.png' },
  collin_chelsea: { name:'Chelsea', leagueKey:'epl', draftTeamId:'collin', boardSub:'Premier League', sub:"Premier League · '26/'27 Season", accent:'#034694', badgeStyle:'background:#034694; color:#FFFFFF;', badgeText:'CHE', sportsdbId:'133610', leagueId:'4328', season:'2026-2027', rundownTeamId:3440, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/pbf4ul1782638263.png' },
  erichylok_astonvilla: { name:'Aston Villa', leagueKey:'epl', draftTeamId:'erichylok', boardSub:'Premier League', sub:"Premier League · '26/'27 Season", accent:'#670E36', badgeStyle:'background:#670E36; color:#95BFE5;', badgeText:'AV', sportsdbId:'133601', leagueId:'4328', season:'2026-2027', rundownTeamId:3437, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/uwzw561787679026.png' },
  patrick_manunited: { name:'Man United', leagueKey:'epl', draftTeamId:'patrick', boardSub:'Premier League', sub:"Premier League · '26/'27 Season", accent:'#DA291C', badgeStyle:'background:#DA291C; color:#FFFFFF;', badgeText:'MU', sportsdbId:'133612', leagueId:'4328', season:'2026-2027', rundownTeamId:3448, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/xzqdr11517660252.png' },
  peter_tottenhamhotspur: { name:'Tottenham Hotspur', leagueKey:'epl', draftTeamId:'peter', boardSub:'Premier League', sub:"Premier League · '26/'27 Season", accent:'#132257', badgeStyle:'background:#132257; color:#FFFFFF;', badgeText:'TH', sportsdbId:'133616', leagueId:'4328', season:'2026-2027', rundownTeamId:3452, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/dfyfhl1604094109.png' },
  ericprister_crystalpalace: { name:'Crystal Palace', leagueKey:'epl', draftTeamId:'ericprister', boardSub:'Premier League', sub:"Premier League · '26/'27 Season", accent:'#1B458F', badgeStyle:'background:#1B458F; color:#C4122E;', badgeText:'CP', sportsdbId:'133632', leagueId:'4328', season:'2026-2027', rundownTeamId:3441, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/ia6i3m1656014992.png' },
  donny_brentford: { name:'Brentford', leagueKey:'epl', draftTeamId:'donny', boardSub:'Premier League', sub:"Premier League · '26/'27 Season", accent:'#E30613', badgeStyle:'background:#E30613; color:#FFFFFF;', badgeText:'BRE', sportsdbId:'134355', leagueId:'4328', season:'2026-2027', rundownTeamId:3469, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/grv1aw1546453779.png' },
  isaac_ipswichtown: { name:'Ipswich Town', leagueKey:'epl', draftTeamId:'isaac', boardSub:'Premier League', sub:"Premier League · '26/'27 Season", accent:'#0044A9', badgeStyle:'background:#0044A9; color:#FFFFFF;', badgeText:'IT', sportsdbId:'133622', leagueId:'4328', season:'2026-2027', rundownTeamId:10708, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/mdj1ey1634670785.png' },
  drew_hullcity: { name:'Hull City', leagueKey:'epl', draftTeamId:'drew', boardSub:'Premier League', sub:"Premier League · '26/'27 Season", accent:'#F18A00', badgeStyle:'background:#F18A00; color:#000000;', badgeText:'HC', sportsdbId:'133617', leagueId:'4328', season:'2026-2027', rundownTeamId:131655, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/fbqqda1601726113.png' },
  douglas_fulham: { name:'Fulham', leagueKey:'epl', draftTeamId:'douglas', boardSub:'Premier League', sub:"Premier League · '26/'27 Season", accent:'#000000', badgeStyle:'background:#FFFFFF; color:#000000;', badgeText:'FUL', sportsdbId:'133600', leagueId:'4328', season:'2026-2027', rundownTeamId:3443, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/xwwvyt1448811086.png' },
  collin_leedsunited: { name:'Leeds United', leagueKey:'epl', draftTeamId:'collin', boardSub:'Premier League', sub:"Premier League · '26/'27 Season", accent:'#1D428A', badgeStyle:'background:#FFFFFF; color:#1D428A;', badgeText:'LU', sportsdbId:'133635', leagueId:'4328', season:'2026-2027', rundownTeamId:3444, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/jcgrml1756649030.png' },
  erichylok_nottingham: { name:'Nottingham', leagueKey:'epl', draftTeamId:'erichylok', boardSub:'Premier League', sub:"Premier League · '26/'27 Season", accent:'#DD0000', badgeStyle:'background:#DD0000; color:#FFFFFF;', badgeText:'NOT', sportsdbId:'133720', leagueId:'4328', season:'2026-2027', rundownTeamId:4272, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/sar2y41781740886.png' },
  patrick_brighton: { name:'Brighton', leagueKey:'epl', draftTeamId:'patrick', boardSub:'Premier League', sub:"Premier League · '26/'27 Season", accent:'#0057B8', badgeStyle:'background:#0057B8; color:#FFFFFF;', badgeText:'BRI', sportsdbId:'133619', leagueId:'4328', season:'2026-2027', rundownTeamId:3438, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/ywypts1448810904.png' },
  peter_afcbournemouth: { name:'AFC Bournemouth', leagueKey:'epl', draftTeamId:'peter', boardSub:'Premier League', sub:"Premier League · '26/'27 Season", accent:'#DA291C', badgeStyle:'background:#DA291C; color:#000000;', badgeText:'AB', sportsdbId:'134301', leagueId:'4328', season:'2026-2027', rundownTeamId:4271, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/y08nak1534071116.png' },
  ericprister_sunderland: { name:'Sunderland', leagueKey:'epl', draftTeamId:'ericprister', boardSub:'Premier League', sub:"Premier League · '26/'27 Season", accent:'#EB172B', badgeStyle:'background:#EB172B; color:#000000;', badgeText:'SUN', sportsdbId:'133603', leagueId:'4328', season:'2026-2027', rundownTeamId:11054, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/tprtus1448813498.png' },
  donny_coventrycity: { name:'Coventry City', leagueKey:'epl', draftTeamId:'donny', boardSub:'Premier League', sub:"Premier League · '26/'27 Season", accent:'#78D0F1', badgeStyle:'background:#78D0F1; color:#1D1D1B;', badgeText:'CC', sportsdbId:'133625', leagueId:'4328', season:'2026-2027', rundownTeamId:131654, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/uxyqys1424033798.png' },
  isaac_eagles: { name:'Eagles', leagueKey:'nfl', draftTeamId:'isaac', boardSub:'Philadelphia', sub:"NFL · Philadelphia · '26 Season", accent:'#004C54', badgeStyle:'background:#004C54; color:#A5ACAF;', badgeText:'PHI', sportsdbId:'134936', rundownTeamId:79, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/pnpybf1515852421.png' },
  drew_chiefs: { name:'Chiefs', leagueKey:'nfl', draftTeamId:'drew', boardSub:'Kansas City', sub:"NFL · Kansas City · '26 Season", accent:'#E31837', badgeStyle:'background:#E31837; color:#FFB81C;', badgeText:'KC', sportsdbId:'134931', rundownTeamId:74, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/n58gp51784720929.png' },
  douglas_texans: { name:'Texans', leagueKey:'nfl', draftTeamId:'douglas', boardSub:'Houston', sub:"NFL · Houston · '26 Season", accent:'#03202F', badgeStyle:'background:#03202F; color:#A71930;', badgeText:'HOU', sportsdbId:'134926', rundownTeamId:69, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/o71ce41784719551.png' },
  collin_seahawks: { name:'Seahawks', leagueKey:'nfl', draftTeamId:'collin', boardSub:'Seattle', sub:"NFL · Seattle · '26 Season", accent:'#002244', badgeStyle:'background:#002244; color:#69BE28;', badgeText:'SEA', sportsdbId:'134949', rundownTeamId:92, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/1t84c51784752684.png' },
  erichylok_49ers: { name:'49ers', leagueKey:'nfl', draftTeamId:'erichylok', boardSub:'San Francisco', sub:"NFL · San Francisco · '26 Season", accent:'#AA0000', badgeStyle:'background:#AA0000; color:#B3995D;', badgeText:'SF', sportsdbId:'134948', rundownTeamId:91, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/bqbtg61539537328.png' },
  patrick_ravens: { name:'Ravens', leagueKey:'nfl', draftTeamId:'patrick', boardSub:'Baltimore', sub:"NFL · Baltimore · '26 Season", accent:'#241773', badgeStyle:'background:#241773; color:#9E7C0C;', badgeText:'BAL', sportsdbId:'134922', rundownTeamId:65, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/einz3p1546172463.png' },
  peter_broncos: { name:'Broncos', leagueKey:'nfl', draftTeamId:'peter', boardSub:'Denver', sub:"NFL · Denver · '26 Season", accent:'#FB4F14', badgeStyle:'background:#FB4F14; color:#002244;', badgeText:'DEN', sportsdbId:'134930', rundownTeamId:73, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/zy3m9v1784718707.png' },
  ericprister_rams: { name:'Rams', leagueKey:'nfl', draftTeamId:'ericprister', boardSub:'Los Angeles', sub:"NFL · Los Angeles · '26 Season", accent:'#003594', badgeStyle:'background:#003594; color:#FFA300;', badgeText:'LAR', sportsdbId:'135907', rundownTeamId:90, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/ojw15x1784721865.png' },
  donny_bucs: { name:'Bucs', leagueKey:'nfl', draftTeamId:'donny', boardSub:'Tampa Bay', sub:"NFL · Tampa Bay · '26 Season", accent:'#D50A0A', badgeStyle:'background:#D50A0A; color:#34302B;', badgeText:'TB', sportsdbId:'134945', rundownTeamId:88, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/2dfpdl1537820969.png' },
  isaac_patriots: { name:'Patriots', leagueKey:'nfl', draftTeamId:'isaac', boardSub:'New England', sub:"NFL · New England · '26 Season", accent:'#002244', badgeStyle:'background:#002244; color:#C60C30;', badgeText:'NE', sportsdbId:'134920', rundownTeamId:63, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/xtwxyt1421431860.png' },
  drew_bengals: { name:'Bengals', leagueKey:'nfl', draftTeamId:'drew', boardSub:'Cincinnati', sub:"NFL · Cincinnati · '26 Season", accent:'#FB4F14', badgeStyle:'background:#FB4F14; color:#000000;', badgeText:'CIN', sportsdbId:'134923', rundownTeamId:66, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/h1ce8y1784717263.png' },
  douglas_falcons: { name:'Falcons', leagueKey:'nfl', draftTeamId:'douglas', boardSub:'Atlanta', sub:"NFL · Atlanta · '26 Season", accent:'#A71930', badgeStyle:'background:#A71930; color:#000000;', badgeText:'ATL', sportsdbId:'134942', rundownTeamId:85, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/9ucfd41784714178.png' },
  collin_giants: { name:'Giants', leagueKey:'nfl', draftTeamId:'collin', boardSub:'New York', sub:"NFL · New York · '26 Season", accent:'#0B2265', badgeStyle:'background:#0B2265; color:#A71930;', badgeText:'NYG', sportsdbId:'134935', rundownTeamId:78, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/i9muak1784751331.png' },
  erichylok_packers: { name:'Packers', leagueKey:'nfl', draftTeamId:'erichylok', boardSub:'Green Bay', sub:"NFL · Green Bay · '26 Season", accent:'#203731', badgeStyle:'background:#203731; color:#FFB612;', badgeText:'GB', sportsdbId:'134940', rundownTeamId:83, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/uwbfw01784719173.png' },
  patrick_colts: { name:'Colts', leagueKey:'nfl', draftTeamId:'patrick', boardSub:'Indianapolis', sub:"NFL · Indianapolis · '26 Season", accent:'#002C5F', badgeStyle:'background:#002C5F; color:#FFFFFF;', badgeText:'IND', sportsdbId:'134927', rundownTeamId:70, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/im99lm1784720368.png' },
  peter_jaguars: { name:'Jaguars', leagueKey:'nfl', draftTeamId:'peter', boardSub:'Jacksonville', sub:"NFL · Jacksonville · '26 Season", accent:'#101820', badgeStyle:'background:#101820; color:#D7A22A;', badgeText:'JAX', sportsdbId:'134928', rundownTeamId:71, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/0mrsd41546427902.png' },
  ericprister_bills: { name:'Bills', leagueKey:'nfl', draftTeamId:'ericprister', boardSub:'Buffalo', sub:"NFL · Buffalo · '26 Season", accent:'#00338D', badgeStyle:'background:#00338D; color:#C60C30;', badgeText:'BUF', sportsdbId:'134918', rundownTeamId:61, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/j4r1tn1784714823.png' },
  donny_vikings: { name:'Vikings', leagueKey:'nfl', draftTeamId:'donny', boardSub:'Minnesota', sub:"NFL · Minnesota · '26 Season", accent:'#4F2683', badgeStyle:'background:#4F2683; color:#FFC62F;', badgeText:'MIN', sportsdbId:'134941', rundownTeamId:84, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/nyp3ev1784722510.png' },
  isaac_titans: { name:'Titans', leagueKey:'nfl', draftTeamId:'isaac', boardSub:'Tennessee', sub:"NFL · Tennessee · '26 Season", accent:'#0C2340', badgeStyle:'background:#0C2340; color:#4B92DB;', badgeText:'TEN', sportsdbId:'134929', rundownTeamId:72, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/3td0f41779180767.png' },
  drew_bears: { name:'Bears', leagueKey:'nfl', draftTeamId:'drew', boardSub:'Chicago', sub:"NFL · Chicago · '26 Season", accent:'#0B162A', badgeStyle:'background:#0B162A; color:#C83803;', badgeText:'CHI', sportsdbId:'134938', rundownTeamId:81, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/0m51zd1784716955.png' },
  douglas_commanders: { name:'Commanders', leagueKey:'nfl', draftTeamId:'douglas', boardSub:'Washington', sub:"NFL · Washington · '26 Season", accent:'#5A1414', badgeStyle:'background:#5A1414; color:#FFB612;', badgeText:'WAS', sportsdbId:'134937', rundownTeamId:80, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/rn0c7v1643826119.png' },
  collin_raiders: { name:'Raiders', leagueKey:'nfl', draftTeamId:'collin', boardSub:'Las Vegas', sub:"NFL · Las Vegas · '26 Season", accent:'#000000', badgeStyle:'background:#000000; color:#A5ACAF;', badgeText:'LV', sportsdbId:'134932', rundownTeamId:75, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/4t8xtk1784721179.png' },
  erichylok_cowboys: { name:'Cowboys', leagueKey:'nfl', draftTeamId:'erichylok', boardSub:'Dallas', sub:"NFL · Dallas · '26 Season", accent:'#041E42', badgeStyle:'background:#041E42; color:#869397;', badgeText:'DAL', sportsdbId:'134934', rundownTeamId:77, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/76ew3c1784718447.png' },
  patrick_saints: { name:'Saints', leagueKey:'nfl', draftTeamId:'patrick', boardSub:'New Orleans', sub:"NFL · New Orleans · '26 Season", accent:'#101820', badgeStyle:'background:#101820; color:#D3BC8D;', badgeText:'NO', sportsdbId:'134944', rundownTeamId:87, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/nd46c71537821337.png' },
  peter_panthers: { name:'Panthers', leagueKey:'nfl', draftTeamId:'peter', boardSub:'Carolina', sub:"NFL · Carolina · '26 Season", accent:'#0085CA', badgeStyle:'background:#0085CA; color:#101820;', badgeText:'CAR', sportsdbId:'134943', rundownTeamId:86, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/kbqini1784716157.png' },
  ericprister_chargers: { name:'Chargers', leagueKey:'nfl', draftTeamId:'ericprister', boardSub:'Los Angeles', sub:"NFL · Los Angeles · '26 Season", accent:'#0080C6', badgeStyle:'background:#0080C6; color:#FFC20E;', badgeText:'LAC', sportsdbId:'135908', rundownTeamId:76, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/wmi40u1784721460.png' },
  donny_jets: { name:'Jets', leagueKey:'nfl', draftTeamId:'donny', boardSub:'New York', sub:"NFL · New York · '26 Season", accent:'#125740', badgeStyle:'background:#125740; color:#FFFFFF;', badgeText:'NYJ', sportsdbId:'134921', rundownTeamId:64, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/6bnwoc1784751677.png' },
  isaac_raptors: { name:'Raptors', leagueKey:'nba', draftTeamId:'isaac', boardSub:'NBA', sub:"NBA · '26/'27 Season", accent:'#C9082A', badgeStyle:'background:#C9082A; color:#FFFFFF;', badgeText:'RAP', sportsdbId:null },
  drew_knicks: { name:'Knicks', leagueKey:'nba', draftTeamId:'drew', boardSub:'NBA', sub:"NBA · '26/'27 Season", accent:'#C9082A', badgeStyle:'background:#C9082A; color:#FFFFFF;', badgeText:'KNI', sportsdbId:null },
  douglas_76ers: { name:'76ers', leagueKey:'nba', draftTeamId:'douglas', boardSub:'NBA', sub:"NBA · '26/'27 Season", accent:'#C9082A', badgeStyle:'background:#C9082A; color:#FFFFFF;', badgeText:'76E', sportsdbId:null },
  collin_blazers: { name:'Blazers', leagueKey:'nba', draftTeamId:'collin', boardSub:'NBA', sub:"NBA · '26/'27 Season", accent:'#C9082A', badgeStyle:'background:#C9082A; color:#FFFFFF;', badgeText:'BLA', sportsdbId:null },
  erichylok_celtics: { name:'Celtics', leagueKey:'nba', draftTeamId:'erichylok', boardSub:'NBA', sub:"NBA · '26/'27 Season", accent:'#C9082A', badgeStyle:'background:#C9082A; color:#FFFFFF;', badgeText:'CEL', sportsdbId:null },
  patrick_spurs: { name:'Spurs', leagueKey:'nba', draftTeamId:'patrick', boardSub:'NBA', sub:"NBA · '26/'27 Season", accent:'#C9082A', badgeStyle:'background:#C9082A; color:#FFFFFF;', badgeText:'SPU', sportsdbId:null },
  peter_pacers: { name:'Pacers', leagueKey:'nba', draftTeamId:'peter', boardSub:'NBA', sub:"NBA · '26/'27 Season", accent:'#C9082A', badgeStyle:'background:#C9082A; color:#FFFFFF;', badgeText:'PAC', sportsdbId:null },
  ericprister_hawks: { name:'Hawks', leagueKey:'nba', draftTeamId:'ericprister', boardSub:'NBA', sub:"NBA · '26/'27 Season", accent:'#C9082A', badgeStyle:'background:#C9082A; color:#FFFFFF;', badgeText:'HAW', sportsdbId:null },
  donny_thunder: { name:'Thunder', leagueKey:'nba', draftTeamId:'donny', boardSub:'NBA', sub:"NBA · '26/'27 Season", accent:'#C9082A', badgeStyle:'background:#C9082A; color:#FFFFFF;', badgeText:'THU', sportsdbId:null },
  isaac_bulls: { name:'Bulls', leagueKey:'nba', draftTeamId:'isaac', boardSub:'NBA', sub:"NBA · '26/'27 Season", accent:'#C9082A', badgeStyle:'background:#C9082A; color:#FFFFFF;', badgeText:'BUL', sportsdbId:null },
  drew_warriors: { name:'Warriors', leagueKey:'nba', draftTeamId:'drew', boardSub:'NBA', sub:"NBA · '26/'27 Season", accent:'#C9082A', badgeStyle:'background:#C9082A; color:#FFFFFF;', badgeText:'WAR', sportsdbId:null },
  douglas_rockets: { name:'Rockets', leagueKey:'nba', draftTeamId:'douglas', boardSub:'NBA', sub:"NBA · '26/'27 Season", accent:'#C9082A', badgeStyle:'background:#C9082A; color:#FFFFFF;', badgeText:'ROC', sportsdbId:null },
  collin_nets: { name:'Nets', leagueKey:'nba', draftTeamId:'collin', boardSub:'NBA', sub:"NBA · '26/'27 Season", accent:'#C9082A', badgeStyle:'background:#C9082A; color:#FFFFFF;', badgeText:'NET', sportsdbId:null },
  erichylok_timberwolves: { name:'Timberwolves', leagueKey:'nba', draftTeamId:'erichylok', boardSub:'NBA', sub:"NBA · '26/'27 Season", accent:'#C9082A', badgeStyle:'background:#C9082A; color:#FFFFFF;', badgeText:'TIM', sportsdbId:null },
  patrick_heat: { name:'Heat', leagueKey:'nba', draftTeamId:'patrick', boardSub:'NBA', sub:"NBA · '26/'27 Season", accent:'#C9082A', badgeStyle:'background:#C9082A; color:#FFFFFF;', badgeText:'HEA', sportsdbId:null },
  peter_jazz: { name:'Jazz', leagueKey:'nba', draftTeamId:'peter', boardSub:'NBA', sub:"NBA · '26/'27 Season", accent:'#C9082A', badgeStyle:'background:#C9082A; color:#FFFFFF;', badgeText:'JAZ', sportsdbId:null },
  ericprister_clippers: { name:'Clippers', leagueKey:'nba', draftTeamId:'ericprister', boardSub:'NBA', sub:"NBA · '26/'27 Season", accent:'#C9082A', badgeStyle:'background:#C9082A; color:#FFFFFF;', badgeText:'CLI', sportsdbId:null },
  donny_pistons: { name:'Pistons', leagueKey:'nba', draftTeamId:'donny', boardSub:'NBA', sub:"NBA · '26/'27 Season", accent:'#C9082A', badgeStyle:'background:#C9082A; color:#FFFFFF;', badgeText:'PIS', sportsdbId:null },
  isaac_pelicans: { name:'Pelicans', leagueKey:'nba', draftTeamId:'isaac', boardSub:'NBA', sub:"NBA · '26/'27 Season", accent:'#C9082A', badgeStyle:'background:#C9082A; color:#FFFFFF;', badgeText:'PEL', sportsdbId:null },
  drew_bucks: { name:'Bucks', leagueKey:'nba', draftTeamId:'drew', boardSub:'NBA', sub:"NBA · '26/'27 Season", accent:'#C9082A', badgeStyle:'background:#C9082A; color:#FFFFFF;', badgeText:'BUC', sportsdbId:null },
  douglas_hornets: { name:'Hornets', leagueKey:'nba', draftTeamId:'douglas', boardSub:'NBA', sub:"NBA · '26/'27 Season", accent:'#C9082A', badgeStyle:'background:#C9082A; color:#FFFFFF;', badgeText:'HOR', sportsdbId:null },
  collin_kings: { name:'Kings', leagueKey:'nba', draftTeamId:'collin', boardSub:'NBA', sub:"NBA · '26/'27 Season", accent:'#C9082A', badgeStyle:'background:#C9082A; color:#FFFFFF;', badgeText:'KIN', sportsdbId:null },
  erichylok_suns: { name:'Suns', leagueKey:'nba', draftTeamId:'erichylok', boardSub:'NBA', sub:"NBA · '26/'27 Season", accent:'#C9082A', badgeStyle:'background:#C9082A; color:#FFFFFF;', badgeText:'SUN', sportsdbId:null },
  patrick_magic: { name:'Magic', leagueKey:'nba', draftTeamId:'patrick', boardSub:'NBA', sub:"NBA · '26/'27 Season", accent:'#C9082A', badgeStyle:'background:#C9082A; color:#FFFFFF;', badgeText:'MAG', sportsdbId:null },
  peter_wizards: { name:'Wizards', leagueKey:'nba', draftTeamId:'peter', boardSub:'NBA', sub:"NBA · '26/'27 Season", accent:'#C9082A', badgeStyle:'background:#C9082A; color:#FFFFFF;', badgeText:'WIZ', sportsdbId:null },
  ericprister_grizzlies: { name:'Grizzlies', leagueKey:'nba', draftTeamId:'ericprister', boardSub:'NBA', sub:"NBA · '26/'27 Season", accent:'#C9082A', badgeStyle:'background:#C9082A; color:#FFFFFF;', badgeText:'GRI', sportsdbId:null },
  donny_lakers: { name:'Lakers', leagueKey:'nba', draftTeamId:'donny', boardSub:'NBA', sub:"NBA · '26/'27 Season", accent:'#C9082A', badgeStyle:'background:#C9082A; color:#FFFFFF;', badgeText:'LAK', sportsdbId:null },
  isaac_ducks: { name:'Ducks', leagueKey:'nhl', draftTeamId:'isaac', boardSub:'NHL', sub:"NHL · '26/'27 Season", accent:'#111111', badgeStyle:'background:#111111; color:#FFFFFF;', badgeText:'DUC', sportsdbId:null },
  drew_stars: { name:'Stars', leagueKey:'nhl', draftTeamId:'drew', boardSub:'NHL', sub:"NHL · '26/'27 Season", accent:'#111111', badgeStyle:'background:#111111; color:#FFFFFF;', badgeText:'STA', sportsdbId:null },
  douglas_mammoth: { name:'Mammoth', leagueKey:'nhl', draftTeamId:'douglas', boardSub:'NHL', sub:"NHL · '26/'27 Season", accent:'#111111', badgeStyle:'background:#111111; color:#FFFFFF;', badgeText:'MAM', sportsdbId:null },
  collin_hurricanes: { name:'Hurricanes', leagueKey:'nhl', draftTeamId:'collin', boardSub:'NHL', sub:"NHL · '26/'27 Season", accent:'#111111', badgeStyle:'background:#111111; color:#FFFFFF;', badgeText:'HUR', sportsdbId:null },
  erichylok_jets: { name:'Jets', leagueKey:'nhl', draftTeamId:'erichylok', boardSub:'NHL', sub:"NHL · '26/'27 Season", accent:'#111111', badgeStyle:'background:#111111; color:#FFFFFF;', badgeText:'JET', sportsdbId:null },
  patrick_oilers: { name:'Oilers', leagueKey:'nhl', draftTeamId:'patrick', boardSub:'NHL', sub:"NHL · '26/'27 Season", accent:'#111111', badgeStyle:'background:#111111; color:#FFFFFF;', badgeText:'OIL', sportsdbId:null },
  peter_goldenknights: { name:'Golden Knights', leagueKey:'nhl', draftTeamId:'peter', boardSub:'NHL', sub:"NHL · '26/'27 Season", accent:'#111111', badgeStyle:'background:#111111; color:#FFFFFF;', badgeText:'GK', sportsdbId:null },
  ericprister_panthers: { name:'Panthers', leagueKey:'nhl', draftTeamId:'ericprister', boardSub:'NHL', sub:"NHL · '26/'27 Season", accent:'#111111', badgeStyle:'background:#111111; color:#FFFFFF;', badgeText:'PAN', sportsdbId:null },
  donny_capitals: { name:'Capitals', leagueKey:'nhl', draftTeamId:'donny', boardSub:'NHL', sub:"NHL · '26/'27 Season", accent:'#111111', badgeStyle:'background:#111111; color:#FFFFFF;', badgeText:'CAP', sportsdbId:null },
  isaac_sabres: { name:'Sabres', leagueKey:'nhl', draftTeamId:'isaac', boardSub:'NHL', sub:"NHL · '26/'27 Season", accent:'#111111', badgeStyle:'background:#111111; color:#FFFFFF;', badgeText:'SAB', sportsdbId:null },
  drew_senators: { name:'Senators', leagueKey:'nhl', draftTeamId:'drew', boardSub:'NHL', sub:"NHL · '26/'27 Season", accent:'#111111', badgeStyle:'background:#111111; color:#FFFFFF;', badgeText:'SEN', sportsdbId:null },
  douglas_predators: { name:'Predators', leagueKey:'nhl', draftTeamId:'douglas', boardSub:'NHL', sub:"NHL · '26/'27 Season", accent:'#111111', badgeStyle:'background:#111111; color:#FFFFFF;', badgeText:'PRE', sportsdbId:null },
  collin_canadiens: { name:'Canadiens', leagueKey:'nhl', draftTeamId:'collin', boardSub:'NHL', sub:"NHL · '26/'27 Season", accent:'#111111', badgeStyle:'background:#111111; color:#FFFFFF;', badgeText:'CAN', sportsdbId:null },
  erichylok_kraken: { name:'Kraken', leagueKey:'nhl', draftTeamId:'erichylok', boardSub:'NHL', sub:"NHL · '26/'27 Season", accent:'#111111', badgeStyle:'background:#111111; color:#FFFFFF;', badgeText:'KRA', sportsdbId:null },
  patrick_sharks: { name:'Sharks', leagueKey:'nhl', draftTeamId:'patrick', boardSub:'NHL', sub:"NHL · '26/'27 Season", accent:'#111111', badgeStyle:'background:#111111; color:#FFFFFF;', badgeText:'SHA', sportsdbId:null },
  peter_devils: { name:'Devils', leagueKey:'nhl', draftTeamId:'peter', boardSub:'NHL', sub:"NHL · '26/'27 Season", accent:'#111111', badgeStyle:'background:#111111; color:#FFFFFF;', badgeText:'DEV', sportsdbId:null },
  ericprister_avalanche: { name:'Avalanche', leagueKey:'nhl', draftTeamId:'ericprister', boardSub:'NHL', sub:"NHL · '26/'27 Season", accent:'#111111', badgeStyle:'background:#111111; color:#FFFFFF;', badgeText:'AVA', sportsdbId:null },
  donny_kings: { name:'Kings', leagueKey:'nhl', draftTeamId:'donny', boardSub:'NHL', sub:"NHL · '26/'27 Season", accent:'#111111', badgeStyle:'background:#111111; color:#FFFFFF;', badgeText:'KIN', sportsdbId:null },
  isaac_bluejackets: { name:'Blue Jackets', leagueKey:'nhl', draftTeamId:'isaac', boardSub:'NHL', sub:"NHL · '26/'27 Season", accent:'#111111', badgeStyle:'background:#111111; color:#FFFFFF;', badgeText:'BJ', sportsdbId:null },
  drew_islanders: { name:'Islanders', leagueKey:'nhl', draftTeamId:'drew', boardSub:'NHL', sub:"NHL · '26/'27 Season", accent:'#111111', badgeStyle:'background:#111111; color:#FFFFFF;', badgeText:'ISL', sportsdbId:null },
  douglas_blues: { name:'Blues', leagueKey:'nhl', draftTeamId:'douglas', boardSub:'NHL', sub:"NHL · '26/'27 Season", accent:'#111111', badgeStyle:'background:#111111; color:#FFFFFF;', badgeText:'BLU', sportsdbId:null },
  collin_mapleleafs: { name:'Maple Leafs', leagueKey:'nhl', draftTeamId:'collin', boardSub:'NHL', sub:"NHL · '26/'27 Season", accent:'#111111', badgeStyle:'background:#111111; color:#FFFFFF;', badgeText:'ML', sportsdbId:null },
  erichylok_canucks: { name:'Canucks', leagueKey:'nhl', draftTeamId:'erichylok', boardSub:'NHL', sub:"NHL · '26/'27 Season", accent:'#111111', badgeStyle:'background:#111111; color:#FFFFFF;', badgeText:'CAN', sportsdbId:null },
  patrick_rangers: { name:'Rangers', leagueKey:'nhl', draftTeamId:'patrick', boardSub:'NHL', sub:"NHL · '26/'27 Season", accent:'#111111', badgeStyle:'background:#111111; color:#FFFFFF;', badgeText:'RAN', sportsdbId:null },
  peter_bruins: { name:'Bruins', leagueKey:'nhl', draftTeamId:'peter', boardSub:'NHL', sub:"NHL · '26/'27 Season", accent:'#111111', badgeStyle:'background:#111111; color:#FFFFFF;', badgeText:'BRU', sportsdbId:null },
  ericprister_wild: { name:'Wild', leagueKey:'nhl', draftTeamId:'ericprister', boardSub:'NHL', sub:"NHL · '26/'27 Season", accent:'#111111', badgeStyle:'background:#111111; color:#FFFFFF;', badgeText:'WIL', sportsdbId:null },
  donny_penguins: { name:'Penguins', leagueKey:'nhl', draftTeamId:'donny', boardSub:'NHL', sub:"NHL · '26/'27 Season", accent:'#111111', badgeStyle:'background:#111111; color:#FFFFFF;', badgeText:'PEN', sportsdbId:null },
  isaac_yankees: { name:'Yankees', leagueKey:'mlb', draftTeamId:'isaac', boardSub:'MLB', sub:"MLB · '27 Season", accent:'#041E42', badgeStyle:'background:#041E42; color:#FFFFFF;', badgeText:'YAN', sportsdbId:null },
  drew_brewers: { name:'Brewers', leagueKey:'mlb', draftTeamId:'drew', boardSub:'MLB', sub:"MLB · '27 Season", accent:'#041E42', badgeStyle:'background:#041E42; color:#FFFFFF;', badgeText:'BRE', sportsdbId:null },
  douglas_bluejays: { name:'Blue Jays', leagueKey:'mlb', draftTeamId:'douglas', boardSub:'MLB', sub:"MLB · '27 Season", accent:'#041E42', badgeStyle:'background:#041E42; color:#FFFFFF;', badgeText:'BJ', sportsdbId:null },
  collin_dodgers: { name:'Dodgers', leagueKey:'mlb', draftTeamId:'collin', boardSub:'MLB', sub:"MLB · '27 Season", accent:'#041E42', badgeStyle:'background:#041E42; color:#FFFFFF;', badgeText:'DOD', sportsdbId:null },
  erichylok_braves: { name:'Braves', leagueKey:'mlb', draftTeamId:'erichylok', boardSub:'MLB', sub:"MLB · '27 Season", accent:'#041E42', badgeStyle:'background:#041E42; color:#FFFFFF;', badgeText:'BRA', sportsdbId:null },
  patrick_twins: { name:'Twins', leagueKey:'mlb', draftTeamId:'patrick', boardSub:'MLB', sub:"MLB · '27 Season", accent:'#041E42', badgeStyle:'background:#041E42; color:#FFFFFF;', badgeText:'TWI', sportsdbId:null },
  peter_orioles: { name:'Orioles', leagueKey:'mlb', draftTeamId:'peter', boardSub:'MLB', sub:"MLB · '27 Season", accent:'#041E42', badgeStyle:'background:#041E42; color:#FFFFFF;', badgeText:'ORI', sportsdbId:null },
  ericprister_rays: { name:'Rays', leagueKey:'mlb', draftTeamId:'ericprister', boardSub:'MLB', sub:"MLB · '27 Season", accent:'#041E42', badgeStyle:'background:#041E42; color:#FFFFFF;', badgeText:'RAY', sportsdbId:null },
  donny_tigers: { name:'Tigers', leagueKey:'mlb', draftTeamId:'donny', boardSub:'MLB', sub:"MLB · '27 Season", accent:'#041E42', badgeStyle:'background:#041E42; color:#FFFFFF;', badgeText:'TIG', sportsdbId:null },
  isaac_guardians: { name:'Guardians', leagueKey:'mlb', draftTeamId:'isaac', boardSub:'MLB', sub:"MLB · '27 Season", accent:'#041E42', badgeStyle:'background:#041E42; color:#FFFFFF;', badgeText:'GUA', sportsdbId:null },
  drew_whitesox: { name:'White Sox', leagueKey:'mlb', draftTeamId:'drew', boardSub:'MLB', sub:"MLB · '27 Season", accent:'#041E42', badgeStyle:'background:#041E42; color:#FFFFFF;', badgeText:'WS', sportsdbId:null },
  douglas_marlins: { name:'Marlins', leagueKey:'mlb', draftTeamId:'douglas', boardSub:'MLB', sub:"MLB · '27 Season", accent:'#041E42', badgeStyle:'background:#041E42; color:#FFFFFF;', badgeText:'MAR', sportsdbId:null },
  collin_redsox: { name:'Red Sox', leagueKey:'mlb', draftTeamId:'collin', boardSub:'MLB', sub:"MLB · '27 Season", accent:'#041E42', badgeStyle:'background:#041E42; color:#FFFFFF;', badgeText:'RS', sportsdbId:null },
  erichylok_astros: { name:'Astros', leagueKey:'mlb', draftTeamId:'erichylok', boardSub:'MLB', sub:"MLB · '27 Season", accent:'#041E42', badgeStyle:'background:#041E42; color:#FFFFFF;', badgeText:'AST', sportsdbId:null },
  patrick_athletics: { name:'Athletics', leagueKey:'mlb', draftTeamId:'patrick', boardSub:'MLB', sub:"MLB · '27 Season", accent:'#041E42', badgeStyle:'background:#041E42; color:#FFFFFF;', badgeText:'ATH', sportsdbId:null },
  peter_royals: { name:'Royals', leagueKey:'mlb', draftTeamId:'peter', boardSub:'MLB', sub:"MLB · '27 Season", accent:'#041E42', badgeStyle:'background:#041E42; color:#FFFFFF;', badgeText:'ROY', sportsdbId:null },
  ericprister_diamondbacks: { name:'Diamondbacks', leagueKey:'mlb', draftTeamId:'ericprister', boardSub:'MLB', sub:"MLB · '27 Season", accent:'#041E42', badgeStyle:'background:#041E42; color:#FFFFFF;', badgeText:'DIA', sportsdbId:null },
  donny_mariners: { name:'Mariners', leagueKey:'mlb', draftTeamId:'donny', boardSub:'MLB', sub:"MLB · '27 Season", accent:'#041E42', badgeStyle:'background:#041E42; color:#FFFFFF;', badgeText:'MAR', sportsdbId:null },
  isaac_mets: { name:'Mets', leagueKey:'mlb', draftTeamId:'isaac', boardSub:'MLB', sub:"MLB · '27 Season", accent:'#041E42', badgeStyle:'background:#041E42; color:#FFFFFF;', badgeText:'MET', sportsdbId:null },
  drew_rockies: { name:'Rockies', leagueKey:'mlb', draftTeamId:'drew', boardSub:'MLB', sub:"MLB · '27 Season", accent:'#041E42', badgeStyle:'background:#041E42; color:#FFFFFF;', badgeText:'ROC', sportsdbId:null },
  douglas_pirates: { name:'Pirates', leagueKey:'mlb', draftTeamId:'douglas', boardSub:'MLB', sub:"MLB · '27 Season", accent:'#041E42', badgeStyle:'background:#041E42; color:#FFFFFF;', badgeText:'PIR', sportsdbId:null },
  collin_phillies: { name:'Phillies', leagueKey:'mlb', draftTeamId:'collin', boardSub:'MLB', sub:"MLB · '27 Season", accent:'#041E42', badgeStyle:'background:#041E42; color:#FFFFFF;', badgeText:'PHI', sportsdbId:null },
  erichylok_rangers: { name:'Rangers', leagueKey:'mlb', draftTeamId:'erichylok', boardSub:'MLB', sub:"MLB · '27 Season", accent:'#041E42', badgeStyle:'background:#041E42; color:#FFFFFF;', badgeText:'RAN', sportsdbId:null },
  patrick_reds: { name:'Reds', leagueKey:'mlb', draftTeamId:'patrick', boardSub:'MLB', sub:"MLB · '27 Season", accent:'#041E42', badgeStyle:'background:#041E42; color:#FFFFFF;', badgeText:'RED', sportsdbId:null },
  peter_angels: { name:'Angels', leagueKey:'mlb', draftTeamId:'peter', boardSub:'MLB', sub:"MLB · '27 Season", accent:'#041E42', badgeStyle:'background:#041E42; color:#FFFFFF;', badgeText:'ANG', sportsdbId:null },
  ericprister_cardinals: { name:'Cardinals', leagueKey:'mlb', draftTeamId:'ericprister', boardSub:'MLB', sub:"MLB · '27 Season", accent:'#041E42', badgeStyle:'background:#041E42; color:#FFFFFF;', badgeText:'CAR', sportsdbId:null },
  donny_giants: { name:'Giants', leagueKey:'mlb', draftTeamId:'donny', boardSub:'MLB', sub:"MLB · '27 Season", accent:'#041E42', badgeStyle:'background:#041E42; color:#FFFFFF;', badgeText:'GIA', sportsdbId:null },
  isaac_mercury: { name:'Mercury', leagueKey:'wnba', draftTeamId:'isaac', boardSub:'WNBA', sub:"WNBA · '27 Season", accent:'#FF6900', badgeStyle:'background:#FF6900; color:#FFFFFF;', badgeText:'MER', sportsdbId:null },
  drew_sky: { name:'Sky', leagueKey:'wnba', draftTeamId:'drew', boardSub:'WNBA', sub:"WNBA · '27 Season", accent:'#FF6900', badgeStyle:'background:#FF6900; color:#FFFFFF;', badgeText:'SKY', sportsdbId:null },
  douglas_lynx: { name:'Lynx', leagueKey:'wnba', draftTeamId:'douglas', boardSub:'WNBA', sub:"WNBA · '27 Season", accent:'#FF6900', badgeStyle:'background:#FF6900; color:#FFFFFF;', badgeText:'LYN', sportsdbId:null },
  collin_dream: { name:'Dream', leagueKey:'wnba', draftTeamId:'collin', boardSub:'WNBA', sub:"WNBA · '27 Season", accent:'#FF6900', badgeStyle:'background:#FF6900; color:#FFFFFF;', badgeText:'DRE', sportsdbId:null },
  erichylok_liberty: { name:'Liberty', leagueKey:'wnba', draftTeamId:'erichylok', boardSub:'WNBA', sub:"WNBA · '27 Season", accent:'#FF6900', badgeStyle:'background:#FF6900; color:#FFFFFF;', badgeText:'LIB', sportsdbId:null },
  patrick_wings: { name:'Wings', leagueKey:'wnba', draftTeamId:'patrick', boardSub:'WNBA', sub:"WNBA · '27 Season", accent:'#FF6900', badgeStyle:'background:#FF6900; color:#FFFFFF;', badgeText:'WIN', sportsdbId:null },
  peter_aces: { name:'Aces', leagueKey:'wnba', draftTeamId:'peter', boardSub:'WNBA', sub:"WNBA · '27 Season", accent:'#FF6900', badgeStyle:'background:#FF6900; color:#FFFFFF;', badgeText:'ACE', sportsdbId:null },
  ericprister_mystics: { name:'Mystics', leagueKey:'wnba', draftTeamId:'ericprister', boardSub:'WNBA', sub:"WNBA · '27 Season", accent:'#FF6900', badgeStyle:'background:#FF6900; color:#FFFFFF;', badgeText:'MYS', sportsdbId:null },
  donny_fever: { name:'Fever', leagueKey:'wnba', draftTeamId:'donny', boardSub:'WNBA', sub:"WNBA · '27 Season", accent:'#FF6900', badgeStyle:'background:#FF6900; color:#FFFFFF;', badgeText:'FEV', sportsdbId:null },
  isaac_ohiostate: { name:'Ohio State', leagueKey:'cfb', draftTeamId:'isaac', boardSub:'Buckeyes', sub:"College Football · '26 Season", accent:'#BB0000', badgeStyle:'background:#BB0000; color:#666666;', badgeText:'OSU', sportsdbId:'136934', recentLabel:'Results So Far', rundownTeamId:194, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/egfzq81564336508.png' },
  drew_georgia: { name:'Georgia', leagueKey:'cfb', draftTeamId:'drew', boardSub:'Bulldogs', sub:"College Football · '26 Season", accent:'#BA0C2F', badgeStyle:'background:#BA0C2F; color:#000000;', badgeText:'UGA', sportsdbId:'137104', recentLabel:'Results So Far', rundownTeamId:153, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/so7nct1641185101.png' },
  douglas_miami: { name:'Miami', leagueKey:'cfb', draftTeamId:'douglas', boardSub:'Hurricanes', sub:"College Football · '26 Season", accent:'#F47321', badgeStyle:'background:#F47321; color:#005030;', badgeText:'MIA', sportsdbId:'136913', recentLabel:'Results So Far', rundownTeamId:174, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/0kqdcr1564336226.png' },
  collin_washington: { name:'Washington', leagueKey:'cfb', draftTeamId:'collin', boardSub:'Huskies', sub:"College Football · '26 Season", accent:'#4B2E83', badgeStyle:'background:#4B2E83; color:#B7A57A;', badgeText:'WASH', sportsdbId:'136974', recentLabel:'Results So Far', rundownTeamId:235, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/9smu951564337111.png' },
  erichylok_usc: { name:'USC', leagueKey:'cfb', draftTeamId:'erichylok', boardSub:'Trojans', sub:"College Football · '26 Season", accent:'#990000', badgeStyle:'background:#990000; color:#FFC72C;', badgeText:'USC', sportsdbId:'136950', recentLabel:'Results So Far', rundownTeamId:209, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/4403h51564337013.png' },
  patrick_liberty: { name:'Liberty', leagueKey:'cfb', draftTeamId:'patrick', boardSub:'Flames', sub:"College Football · '26 Season", accent:'#C41230', badgeStyle:'background:#C41230; color:#041E42;', badgeText:'LIB', sportsdbId:'136904', recentLabel:'Results So Far', rundownTeamId:382, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/z26guc1564336125.png' },
  peter_texas: { name:'Texas', leagueKey:'cfb', draftTeamId:'peter', boardSub:'Longhorns', sub:"College Football · '26 Season", accent:'#BF5700', badgeStyle:'background:#BF5700; color:#FFFFFF;', badgeText:'TEX', sportsdbId:'136958', recentLabel:'Results So Far', rundownTeamId:217, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/jjyr0y1564336795.png' },
  ericprister_oklahoma: { name:'Oklahoma', leagueKey:'cfb', draftTeamId:'ericprister', boardSub:'Sooners', sub:"College Football · '26 Season", accent:'#841617', badgeStyle:'background:#841617; color:#FDF9D8;', badgeText:'OU', sportsdbId:'136935', recentLabel:'Results So Far', rundownTeamId:195, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/pfm7mq1564336521.png' },
  donny_texastech: { name:'Texas Tech', leagueKey:'cfb', draftTeamId:'donny', boardSub:'Red Raiders', sub:"College Football · '26 Season", accent:'#CC0000', badgeStyle:'background:#CC0000; color:#000000;', badgeText:'TTU', sportsdbId:'136961', recentLabel:'Results So Far', rundownTeamId:219, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/vksj451564336834.png' },
  isaac_notredame: { name:'Notre Dame', leagueKey:'cfb', draftTeamId:'isaac', boardSub:'Fighting Irish', sub:"College Football · '26 Season", accent:'#0C2340', badgeStyle:'background:#0C2340; color:#C99700;', badgeText:'ND', sportsdbId:'136246', recentLabel:'Results So Far', rundownTeamId:192, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/w0jd2o1564336487.png' },
  drew_pennstate: { name:'Penn State', leagueKey:'cfb', draftTeamId:'drew', boardSub:'Nittany Lions', sub:"College Football · '26 Season", accent:'#041E42', badgeStyle:'background:#041E42; color:#FFFFFF;', badgeText:'PSU', sportsdbId:'136940', recentLabel:'Results So Far', rundownTeamId:200, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/q1t6wc1568478893.png' },
  douglas_lsu: { name:'LSU', leagueKey:'cfb', draftTeamId:'douglas', boardSub:'Tigers', sub:"College Football · '26 Season", accent:'#461D7C', badgeStyle:'background:#461D7C; color:#FDD023;', badgeText:'LSU', sportsdbId:'136905', recentLabel:'Results So Far', rundownTeamId:170, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/jcj91i1564336177.png' },
  collin_toledo: { name:'Toledo', leagueKey:'cfb', draftTeamId:'collin', boardSub:'Rockets', sub:"College Football · '26 Season", accent:'#00256C', badgeStyle:'background:#00256C; color:#FFCC00;', badgeText:'TOL', sportsdbId:'136964', recentLabel:'Results So Far', rundownTeamId:220, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/op6auv1564336847.png' },
  erichylok_smu: { name:'SMU', leagueKey:'cfb', draftTeamId:'erichylok', boardSub:'Mustangs', sub:"College Football · '26 Season", accent:'#C8102E', badgeStyle:'background:#C8102E; color:#0033A0;', badgeText:'SMU', sportsdbId:'136951', recentLabel:'Results So Far', rundownTeamId:210, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/csw4ek1564336678.png' },
  patrick_westernmichigan: { name:'Western Michigan', leagueKey:'cfb', draftTeamId:'patrick', boardSub:'Broncos', sub:"College Football · '26 Season", accent:'#532E1F', badgeStyle:'background:#532E1F; color:#FFC72C;', badgeText:'WMU', sportsdbId:'136978', recentLabel:'Results So Far', rundownTeamId:239, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/4nmakk1641186437.png' },
  peter_iu: { name:'IU', leagueKey:'cfb', draftTeamId:'peter', boardSub:'Hoosiers', sub:"College Football · '26 Season", accent:'#990000', badgeStyle:'background:#990000; color:#EEEDEB;', badgeText:'IU', sportsdbId:'136897', recentLabel:'Results So Far', rundownTeamId:159, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/pwcsog1564336028.png' },
  ericprister_jamesmadison: { name:'James Madison', leagueKey:'cfb', draftTeamId:'ericprister', boardSub:'Dukes', sub:"College Football · '26 Season", accent:'#450084', badgeStyle:'background:#450084; color:#CBB677;', badgeText:'JMU', sportsdbId:'137034', recentLabel:'Results So Far', rundownTeamId:494, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/fdqmd11564356998.png' },
  donny_newmexico: { name:'New Mexico', leagueKey:'cfb', draftTeamId:'donny', boardSub:'Lobos', sub:"College Football · '26 Season", accent:'#BA0C2F', badgeStyle:'background:#BA0C2F; color:#A7A8AA;', badgeText:'UNM', sportsdbId:'136926', recentLabel:'Results So Far', rundownTeamId:185, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/dpo6hf1564336363.png' },
  isaac_boisestate: { name:'Boise State', leagueKey:'cfb', draftTeamId:'isaac', boardSub:'Broncos', sub:"College Football · '26 Season", accent:'#0033A0', badgeStyle:'background:#0033A0; color:#D64309;', badgeText:'BSU', sportsdbId:'136867', recentLabel:'Results So Far', rundownTeamId:133, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/xoc6qn1564335585.png' },
  drew_ndsu: { name:'NDSU', leagueKey:'cfb', draftTeamId:'drew', boardSub:'Bison', sub:"College Football · '26 Season", accent:'#0A5C36', badgeStyle:'background:#0A5C36; color:#FFCB05;', badgeText:'NDSU', sportsdbId:'137056', recentLabel:'Results So Far', rundownTeamId:380, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/35rm031564357382.png' },
  douglas_houston: { name:'Houston', leagueKey:'cfb', draftTeamId:'douglas', boardSub:'Cougars', sub:"College Football · '26 Season", accent:'#C8102E', badgeStyle:'background:#C8102E; color:#FFFFFF;', badgeText:'HOU', sportsdbId:'136895', recentLabel:'Results So Far', rundownTeamId:156, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/xznb791564335987.png' },
  collin_olemiss: { name:'Ole Miss', leagueKey:'cfb', draftTeamId:'collin', boardSub:'Rebels', sub:"College Football · '26 Season", accent:'#14213D', badgeStyle:'background:#14213D; color:#CE1126;', badgeText:'OM', sportsdbId:'136919', recentLabel:'Results So Far', rundownTeamId:197, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/l74mp21564336550.png' },
  erichylok_byu: { name:'BYU', leagueKey:'cfb', draftTeamId:'erichylok', boardSub:'Cougars', sub:"College Football · '26 Season", accent:'#002E5D', badgeStyle:'background:#002E5D; color:#FFFFFF;', badgeText:'BYU', sportsdbId:'136871', recentLabel:'Results So Far', rundownTeamId:447, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/ypg2cw1641184997.png' },
  patrick_navy: { name:'Navy', leagueKey:'cfb', draftTeamId:'patrick', boardSub:'Midshipmen', sub:"College Football · '26 Season", accent:'#00205B', badgeStyle:'background:#00205B; color:#B58500;', badgeText:'NAVY', sportsdbId:'136922', recentLabel:'Results So Far', rundownTeamId:182, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/y9dlzu1564336318.png' },
  peter_virginia: { name:'Virginia', leagueKey:'cfb', draftTeamId:'peter', boardSub:'Cavaliers', sub:"College Football · '26 Season", accent:'#232D4B', badgeStyle:'background:#232D4B; color:#E57200;', badgeText:'UVA', sportsdbId:'136971', recentLabel:'Results So Far', rundownTeamId:232, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/2cvvb01641184446.png' },
  ericprister_memphis: { name:'Memphis', leagueKey:'cfb', draftTeamId:'ericprister', boardSub:'Tigers', sub:"College Football · '26 Season", accent:'#003087', badgeStyle:'background:#003087; color:#898D8D;', badgeText:'MEM', sportsdbId:'136912', recentLabel:'Results So Far', rundownTeamId:173, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/wvucol1564336213.png' },
  donny_louisville: { name:'Louisville', leagueKey:'cfb', draftTeamId:'donny', boardSub:'Cardinals', sub:"College Football · '26 Season", accent:'#AD0000', badgeStyle:'background:#AD0000; color:#000000;', badgeText:'LOU', sportsdbId:'136908', recentLabel:'Results So Far', rundownTeamId:169, badgeUrl:'https://r2.thesportsdb.com/images/media/team/badge/eb6qjl1564336166.png' },
  isaac_uconn: { name:'UConn', leagueKey:'mcbb', draftTeamId:'isaac', boardSub:'College BB', sub:"College BB · '26/'27 Season", accent:'#CC5500', badgeStyle:'background:#CC5500; color:#FFFFFF;', badgeText:'UCO', sportsdbId:null },
  drew_michigan: { name:'Michigan', leagueKey:'mcbb', draftTeamId:'drew', boardSub:'College BB', sub:"College BB · '26/'27 Season", accent:'#CC5500', badgeStyle:'background:#CC5500; color:#FFFFFF;', badgeText:'MIC', sportsdbId:null },
  douglas_duke: { name:'Duke', leagueKey:'mcbb', draftTeamId:'douglas', boardSub:'College BB', sub:"College BB · '26/'27 Season", accent:'#CC5500', badgeStyle:'background:#CC5500; color:#FFFFFF;', badgeText:'DUK', sportsdbId:null },
  collin_arizona: { name:'Arizona', leagueKey:'mcbb', draftTeamId:'collin', boardSub:'College BB', sub:"College BB · '26/'27 Season", accent:'#CC5500', badgeStyle:'background:#CC5500; color:#FFFFFF;', badgeText:'ARI', sportsdbId:null },
  erichylok_kansas: { name:'Kansas', leagueKey:'mcbb', draftTeamId:'erichylok', boardSub:'College BB', sub:"College BB · '26/'27 Season", accent:'#CC5500', badgeStyle:'background:#CC5500; color:#FFFFFF;', badgeText:'KAN', sportsdbId:null },
  patrick_illinois: { name:'Illinois', leagueKey:'mcbb', draftTeamId:'patrick', boardSub:'College BB', sub:"College BB · '26/'27 Season", accent:'#CC5500', badgeStyle:'background:#CC5500; color:#FFFFFF;', badgeText:'ILL', sportsdbId:null },
  peter_michstate: { name:'Mich State', leagueKey:'mcbb', draftTeamId:'peter', boardSub:'College BB', sub:"College BB · '26/'27 Season", accent:'#CC5500', badgeStyle:'background:#CC5500; color:#FFFFFF;', badgeText:'MS', sportsdbId:null },
  ericprister_iowastate: { name:'Iowa State', leagueKey:'mcbb', draftTeamId:'ericprister', boardSub:'College BB', sub:"College BB · '26/'27 Season", accent:'#CC5500', badgeStyle:'background:#CC5500; color:#FFFFFF;', badgeText:'IS', sportsdbId:null },
  donny_florida: { name:'Florida', leagueKey:'mcbb', draftTeamId:'donny', boardSub:'College BB', sub:"College BB · '26/'27 Season", accent:'#CC5500', badgeStyle:'background:#CC5500; color:#FFFFFF;', badgeText:'FLO', sportsdbId:null },
  isaac_tennessee: { name:'Tennessee', leagueKey:'mcbb', draftTeamId:'isaac', boardSub:'College BB', sub:"College BB · '26/'27 Season", accent:'#CC5500', badgeStyle:'background:#CC5500; color:#FFFFFF;', badgeText:'TEN', sportsdbId:null },
  drew_alabama: { name:'Alabama', leagueKey:'mcbb', draftTeamId:'drew', boardSub:'College BB', sub:"College BB · '26/'27 Season", accent:'#CC5500', badgeStyle:'background:#CC5500; color:#FFFFFF;', badgeText:'ALA', sportsdbId:null },
  douglas_texas: { name:'Texas', leagueKey:'mcbb', draftTeamId:'douglas', boardSub:'College BB', sub:"College BB · '26/'27 Season", accent:'#CC5500', badgeStyle:'background:#CC5500; color:#FFFFFF;', badgeText:'TEX', sportsdbId:null },
  collin_stjohns: { name:'St Johns', leagueKey:'mcbb', draftTeamId:'collin', boardSub:'College BB', sub:"College BB · '26/'27 Season", accent:'#CC5500', badgeStyle:'background:#CC5500; color:#FFFFFF;', badgeText:'SJ', sportsdbId:null },
  erichylok_virginia: { name:'Virginia', leagueKey:'mcbb', draftTeamId:'erichylok', boardSub:'College BB', sub:"College BB · '26/'27 Season", accent:'#CC5500', badgeStyle:'background:#CC5500; color:#FFFFFF;', badgeText:'VIR', sportsdbId:null },
  patrick_kentucky: { name:'Kentucky', leagueKey:'mcbb', draftTeamId:'patrick', boardSub:'College BB', sub:"College BB · '26/'27 Season", accent:'#CC5500', badgeStyle:'background:#CC5500; color:#FFFFFF;', badgeText:'KEN', sportsdbId:null },
  peter_arkansas: { name:'Arkansas', leagueKey:'mcbb', draftTeamId:'peter', boardSub:'College BB', sub:"College BB · '26/'27 Season", accent:'#CC5500', badgeStyle:'background:#CC5500; color:#FFFFFF;', badgeText:'ARK', sportsdbId:null },
  ericprister_vanderbilt: { name:'Vanderbilt', leagueKey:'mcbb', draftTeamId:'ericprister', boardSub:'College BB', sub:"College BB · '26/'27 Season", accent:'#CC5500', badgeStyle:'background:#CC5500; color:#FFFFFF;', badgeText:'VAN', sportsdbId:null },
  donny_saintmarys: { name:'Saint Mary\'s', leagueKey:'mcbb', draftTeamId:'donny', boardSub:'College BB', sub:"College BB · '26/'27 Season", accent:'#CC5500', badgeStyle:'background:#CC5500; color:#FFFFFF;', badgeText:'SMS', sportsdbId:null },
  isaac_miami: { name:'Miami', leagueKey:'mcbb', draftTeamId:'isaac', boardSub:'College BB', sub:"College BB · '26/'27 Season", accent:'#CC5500', badgeStyle:'background:#CC5500; color:#FFFFFF;', badgeText:'MIA', sportsdbId:null },
  drew_gonzaga: { name:'Gonzaga', leagueKey:'mcbb', draftTeamId:'drew', boardSub:'College BB', sub:"College BB · '26/'27 Season", accent:'#CC5500', badgeStyle:'background:#CC5500; color:#FFFFFF;', badgeText:'GON', sportsdbId:null },
  douglas_texastech: { name:'Texas Tech', leagueKey:'mcbb', draftTeamId:'douglas', boardSub:'College BB', sub:"College BB · '26/'27 Season", accent:'#CC5500', badgeStyle:'background:#CC5500; color:#FFFFFF;', badgeText:'TT', sportsdbId:null },
  collin_northcarolina: { name:'North Carolina', leagueKey:'mcbb', draftTeamId:'collin', boardSub:'College BB', sub:"College BB · '26/'27 Season", accent:'#CC5500', badgeStyle:'background:#CC5500; color:#FFFFFF;', badgeText:'NC', sportsdbId:null },
  erichylok_nebraska: { name:'Nebraska', leagueKey:'mcbb', draftTeamId:'erichylok', boardSub:'College BB', sub:"College BB · '26/'27 Season", accent:'#CC5500', badgeStyle:'background:#CC5500; color:#FFFFFF;', badgeText:'NEB', sportsdbId:null },
  patrick_ndsu: { name:'NDSU', leagueKey:'mcbb', draftTeamId:'patrick', boardSub:'College BB', sub:"College BB · '26/'27 Season", accent:'#CC5500', badgeStyle:'background:#CC5500; color:#FFFFFF;', badgeText:'NDS', sportsdbId:null },
  peter_slu: { name:'SLU', leagueKey:'mcbb', draftTeamId:'peter', boardSub:'College BB', sub:"College BB · '26/'27 Season", accent:'#CC5500', badgeStyle:'background:#CC5500; color:#FFFFFF;', badgeText:'SLU', sportsdbId:null },
  ericprister_georgia: { name:'Georgia', leagueKey:'mcbb', draftTeamId:'ericprister', boardSub:'College BB', sub:"College BB · '26/'27 Season", accent:'#CC5500', badgeStyle:'background:#CC5500; color:#FFFFFF;', badgeText:'GEO', sportsdbId:null },
  donny_louisville_cbb: { name:'Louisville', leagueKey:'mcbb', draftTeamId:'donny', boardSub:'College BB', sub:"College BB · '26/'27 Season", accent:'#CC5500', badgeStyle:'background:#CC5500; color:#FFFFFF;', badgeText:'LOU', sportsdbId:null }
};

// Board order: which teams appear under each league tab (across all
// drafters — filtered down to one drafter's roster at render time),
// and the season label shown next to the league name.
export const LEAGUES = [
  { key:'epl', label:'EPL', season:"'26/'27 Season", teams:['isaac_arsenal', 'drew_mancity', 'douglas_everton', 'collin_chelsea', 'erichylok_astonvilla', 'liverpool', 'patrick_manunited', 'peter_tottenhamhotspur', 'ericprister_crystalpalace', 'donny_brentford', 'isaac_ipswichtown', 'drew_hullcity', 'douglas_fulham', 'collin_leedsunited', 'erichylok_nottingham', 'newcastle', 'patrick_brighton', 'peter_afcbournemouth', 'ericprister_sunderland', 'donny_coventrycity'] },
  { key:'cfb', label:'College FB', season:"'26 Season", teams:['isaac_ohiostate', 'drew_georgia', 'douglas_miami', 'collin_washington', 'erichylok_usc', 'oregon', 'patrick_liberty', 'peter_texas', 'ericprister_oklahoma', 'donny_texastech', 'isaac_notredame', 'drew_pennstate', 'douglas_lsu', 'collin_toledo', 'erichylok_smu', 'texasam', 'patrick_westernmichigan', 'peter_iu', 'ericprister_jamesmadison', 'donny_newmexico', 'isaac_boisestate', 'drew_ndsu', 'douglas_houston', 'collin_olemiss', 'erichylok_byu', 'arizona', 'patrick_navy', 'peter_virginia', 'ericprister_memphis', 'donny_louisville'] },
  { key:'nfl', label:'NFL', season:"'26 Season", teams:['isaac_eagles', 'drew_chiefs', 'douglas_texans', 'collin_seahawks', 'erichylok_49ers', 'lions', 'patrick_ravens', 'peter_broncos', 'ericprister_rams', 'donny_bucs', 'isaac_patriots', 'drew_bengals', 'douglas_falcons', 'collin_giants', 'erichylok_packers', 'steelers', 'patrick_colts', 'peter_jaguars', 'ericprister_bills', 'donny_vikings', 'isaac_titans', 'drew_bears', 'douglas_commanders', 'collin_raiders', 'erichylok_cowboys', 'dolphins', 'patrick_saints', 'peter_panthers', 'ericprister_chargers', 'donny_jets'] },
  { key:'mcbb', label:'College BB', season:"'26/'27 Season", teams:['isaac_uconn', 'drew_michigan', 'douglas_duke', 'collin_arizona', 'erichylok_kansas', 'houston', 'patrick_illinois', 'peter_michstate', 'ericprister_iowastate', 'donny_florida', 'isaac_tennessee', 'drew_alabama', 'douglas_texas', 'collin_stjohns', 'erichylok_virginia', 'purdue', 'patrick_kentucky', 'peter_arkansas', 'ericprister_vanderbilt', 'donny_saintmarys', 'isaac_miami', 'drew_gonzaga', 'douglas_texastech', 'collin_northcarolina', 'erichylok_nebraska', 'utahstate', 'patrick_ndsu', 'peter_slu', 'ericprister_georgia', 'donny_louisville_cbb'] },
  { key:'nba', label:'NBA', season:"'26/'27 Season", teams:['isaac_raptors', 'drew_knicks', 'douglas_76ers', 'collin_blazers', 'erichylok_celtics', 'cavaliers', 'patrick_spurs', 'peter_pacers', 'ericprister_hawks', 'donny_thunder', 'isaac_bulls', 'drew_warriors', 'douglas_rockets', 'collin_nets', 'erichylok_timberwolves', 'nuggets', 'patrick_heat', 'peter_jazz', 'ericprister_clippers', 'donny_pistons', 'isaac_pelicans', 'drew_bucks', 'douglas_hornets', 'collin_kings', 'erichylok_suns', 'mavericks', 'patrick_magic', 'peter_wizards', 'ericprister_grizzlies', 'donny_lakers'] },
  { key:'nhl', label:'NHL', season:"'26/'27 Season", teams:['isaac_ducks', 'drew_stars', 'douglas_mammoth', 'collin_hurricanes', 'erichylok_jets', 'lightning', 'patrick_oilers', 'peter_goldenknights', 'ericprister_panthers', 'donny_capitals', 'isaac_sabres', 'drew_senators', 'douglas_predators', 'collin_canadiens', 'erichylok_kraken', 'flyers', 'patrick_sharks', 'peter_devils', 'ericprister_avalanche', 'donny_kings', 'isaac_bluejackets', 'drew_islanders', 'douglas_blues', 'collin_mapleleafs', 'erichylok_canucks', 'redwings', 'patrick_rangers', 'peter_bruins', 'ericprister_wild', 'donny_penguins'] },
  { key:'mlb', label:'MLB', season:"'27 Season", teams:['isaac_yankees', 'drew_brewers', 'douglas_bluejays', 'collin_dodgers', 'erichylok_braves', 'cubs', 'patrick_twins', 'peter_orioles', 'ericprister_rays', 'donny_tigers', 'isaac_guardians', 'drew_whitesox', 'douglas_marlins', 'collin_redsox', 'erichylok_astros', 'padres', 'patrick_athletics', 'peter_royals', 'ericprister_diamondbacks', 'donny_mariners', 'isaac_mets', 'drew_rockies', 'douglas_pirates', 'collin_phillies', 'erichylok_rangers', 'nationals', 'patrick_reds', 'peter_angels', 'ericprister_cardinals', 'donny_giants'] },
  { key:'wnba', label:'WNBA', season:"'27 Season", teams:['isaac_mercury', 'drew_sky', 'douglas_lynx', 'collin_dream', 'erichylok_liberty', 'valkyries', 'patrick_wings', 'peter_aces', 'ericprister_mystics', 'donny_fever'] }
];

// MLB and WNBA drafted teams score starting with the '27 season (see
// their LEAGUES season labels above — "'27 Season" only, not "'26/'27"
// like EPL/NBA/NHL/mcbb) — but ESPN's live standings/schedule
// endpoints always return whatever season is actually being played
// right now, which today is still each league's '26 season. Until
// each league's '27 season actually starts, the Standings tab and
// team modal are showing real '26 results that don't count toward the
// draft — flagged here so js/board.js and js/live-data.js can both
// surface the same heads-up instead of drifting out of sync.
export const PRIOR_SEASON_DISPLAY_LEAGUES = ['mlb', 'wnba'];

export const LEAGUE_SCORING = {
  epl: {
    name: 'EPL',
    full: 'Premier League Scoring',
    accent: '#3D195B',
    // rankAuto rules are derived automatically from the live standings
    // table (see getLeagueRuleTeams in js/league-facts.js) rather than marked by hand.
    // exclusive rules can only ever be true for one team at a time —
    // marking a new team for them replaces whoever was marked before.
    rules: [
      { label: 'Win League Cup', pts: 1, exclusive: true },
      { label: 'Win FA Cup', pts: 2, exclusive: true },
      { label: 'Make Europa League', pts: 3 },
      { label: 'Make Champions League (any stage)', pts: 4 },
      { label: '3rd in EPL', pts: 3, rankAuto: { rank: 3 } },
      { label: '2nd in EPL', pts: 6, rankAuto: { rank: 2 } },
      { label: 'Win EPL', pts: 9, rankAuto: { rank: 1 } },
      { label: 'Relegation', pts: -5, rankAuto: { bottom: 3 } }
    ],
    bonus: { label: 'Highest combined win-loss-draw point total across your teams', pts: 5 }
  },
  nfl: {
    name: 'NFL',
    full: 'NFL Scoring',
    accent: '#013369',
    rules: [
      { label: 'Make the playoffs', pts: 1 },
      { label: 'Division title', pts: 2 },
      { label: 'Best record in conference', pts: 3 },
      { label: 'Make conference championship', pts: 2 },
      { label: 'Make Super Bowl', pts: 3 },
      { label: 'Win Super Bowl', pts: 5 },
      { label: 'Last place in division', pts: -2 },
      { label: 'Worst record in conference', pts: -3 }
    ],
    bonus: { label: 'Best combined win percentage across your teams', pts: 5 }
  },
  nba: {
    name: 'NBA',
    full: 'NBA Scoring',
    accent: '#C9082A',
    rules: [
      { label: 'Make the playoffs', pts: 1 },
      { label: 'Division title', pts: 2 },
      { label: 'Best record in conference', pts: 3 },
      { label: 'Make conference finals', pts: 2 },
      { label: 'Make Finals', pts: 3 },
      { label: 'Win Finals', pts: 5 },
      { label: 'Last place in division', pts: -2 },
      { label: 'Worst record in conference', pts: -3 }
    ],
    bonus: { label: 'Best combined win percentage across your teams', pts: 5 }
  },
  nhl: {
    name: 'NHL',
    full: 'NHL Scoring',
    accent: '#111111',
    rules: [
      { label: 'Make the playoffs', pts: 1 },
      { label: 'Division title', pts: 2 },
      { label: 'Best record in conference', pts: 3 },
      { label: 'Make conference finals', pts: 2 },
      { label: 'Make Stanley Cup Finals', pts: 3 },
      { label: 'Win Stanley Cup Finals', pts: 5 },
      { label: 'Last place in division', pts: -2 },
      { label: 'Worst record in conference', pts: -3 }
    ],
    bonus: { label: 'Best combined win percentage across your teams', pts: 5 }
  },
  mlb: {
    name: 'MLB',
    full: 'MLB Scoring',
    accent: '#041E42',
    rules: [
      { label: 'Make the playoffs', pts: 1 },
      { label: 'Division title', pts: 2 },
      { label: 'Best record in league', pts: 3 },
      { label: 'Make LCS', pts: 2 },
      { label: 'Make World Series', pts: 3 },
      { label: 'Win World Series', pts: 5 },
      { label: 'Last place in division', pts: -2 },
      { label: 'Worst record in league', pts: -3 }
    ],
    bonus: { label: 'Best combined win percentage across your teams', pts: 5 }
  },
  wnba: {
    name: 'WNBA',
    full: 'WNBA Scoring',
    accent: '#FF6900',
    rules: [
      { label: 'Make the playoffs', pts: 1 },
      { label: 'Top-two regular-season record', pts: 2 },
      { label: 'Reach Commissioner’s Cup Final', pts: 1 },
      { label: 'Win Commissioner’s Cup', pts: 2 },
      { label: 'Reach the semifinals', pts: 2 },
      { label: 'Reach the Finals', pts: 3 },
      { label: 'Win the Finals', pts: 5 },
      { label: 'Missing the playoffs', pts: -3 },
      { label: 'Bottom-three record', pts: -2 }
    ],
    bonus: { label: 'Best combined win percentage across your teams', pts: 5 }
  },
  cfb: {
    name: 'College FB',
    full: 'College Football Scoring',
    accent: '#013220',
    rules: [
      { label: 'Make a bowl game', pts: 1 },
      { label: 'Win a bowl game', pts: 1 },
      { label: 'Win conference', pts: 2 },
      { label: 'Make the CFP', pts: 2 },
      { label: 'Make the CFP semifinal', pts: 2 },
      { label: 'Make National Championship', pts: 3 },
      { label: 'Win National Championship', pts: 5 },
      { label: 'Don’t make a bowl', pts: -2 },
      { label: 'Finish last in conference', pts: -3 }
    ],
    bonus: { label: 'Best combined win percentage across your teams', pts: 5 }
  },
  mcbb: {
    name: 'College BB',
    full: 'College Basketball Scoring',
    accent: '#CC5500',
    rules: [
      { label: 'Make NCAA Tournament', pts: 1 },
      { label: 'Win conference tournament', pts: 2 },
      { label: 'Win conference regular season', pts: 3 },
      { label: 'Make Elite Eight', pts: 2 },
      { label: 'Make National Championship game', pts: 3 },
      { label: 'Win National Championship', pts: 5 },
      { label: 'Don’t make NCAA tournament', pts: -2 },
      { label: 'Finish last in conference', pts: -3 }
    ],
    bonus: { label: 'Best combined win percentage across your teams', pts: 5 }
  }
};
