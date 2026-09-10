/* ============================================================
   Board content: leagues, teams, and scoring rules.
   This is the file to edit when adding/removing a team or league
   — everything else in js/app.js just reads from these objects.
   ============================================================ */

// The 10 people in the fantasy draft. Every team in TEAM_META
// belongs to exactly one of these via its draftTeamId field.
const DRAFT_TEAMS = [
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
// leagueKey links each team to its LEAGUE_SCORING entry below.
// draftTeamId links each team to its owner in DRAFT_TEAMS above.
//
// Only Josh's 21 teams (below) have full metadata (city, real
// badge colors, live sportsdbId) filled in so far. The other 189
// teams — one roster per drafter, pulled from the shared draft
// spreadsheet — are appended further down as a skeleton: correct
// name/league/owner, a league-colored placeholder badge, and no
// live data yet. Fill those in incrementally as time allows.
const TEAM_META = {
  liverpool:  { name:'Liverpool',   leagueKey:'epl',  draftTeamId:'josh', boardSub:'Premier League', sub:"Premier League · '26/'27 Season", accent:'#C8102E', badgeStyle:'background:#C8102E; color:#F6EB61;', badgeText:'LFC',  sportsdbId:'133602', leagueId:'4328', season:'2026-2027' },
  newcastle:  { name:'Newcastle',   leagueKey:'epl',  draftTeamId:'josh', boardSub:'Premier League', sub:"Premier League · '26/'27 Season", accent:'#241F20', badgeStyle:'background:#241F20; color:#FFFFFF;', badgeText:'NUFC', sportsdbId:'134777', leagueId:'4328', season:'2026-2027' },

  lions:      { name:'Lions',       leagueKey:'nfl',  draftTeamId:'josh', boardSub:'Detroit',     sub:"NFL · Detroit · '26 Season",     accent:'#0076B6', badgeStyle:'background:#0076B6; color:#B0B7BC;', badgeText:'DET',  sportsdbId:'134939' },
  steelers:   { name:'Steelers',    leagueKey:'nfl',  draftTeamId:'josh', boardSub:'Pittsburgh',  sub:"NFL · Pittsburgh · '26 Season",  accent:'#101820', badgeStyle:'background:#101820; color:#FFB612;', badgeText:'PIT',  sportsdbId:'134925' },
  dolphins:   { name:'Dolphins',    leagueKey:'nfl',  draftTeamId:'josh', boardSub:'Miami',       sub:"NFL · Miami · '26 Season",       accent:'#008E97', badgeStyle:'background:#008E97; color:#F58220;', badgeText:'MIA',  sportsdbId:'134919' },

  cavaliers:  { name:'Cavaliers',   leagueKey:'nba',  draftTeamId:'josh', boardSub:'Cleveland',   sub:"NBA · Cleveland · '26/'27 Season", accent:'#860038', badgeStyle:'background:#860038; color:#FDBB30;', badgeText:'CLE',  sportsdbId:'134871' },
  nuggets:    { name:'Nuggets',     leagueKey:'nba',  draftTeamId:'josh', boardSub:'Denver',      sub:"NBA · Denver · '26/'27 Season",   accent:'#0E2240', badgeStyle:'background:#0E2240; color:#FEC524;', badgeText:'DEN',  sportsdbId:'134885' },
  mavericks:  { name:'Mavs',        leagueKey:'nba',  draftTeamId:'josh', boardSub:'Dallas',      sub:"NBA · Dallas · '26/'27 Season",   accent:'#00538C', badgeStyle:'background:#00538C; color:#B8C4CA;', badgeText:'DAL',  sportsdbId:'134875' },

  lightning:  { name:'Lightning',   leagueKey:'nhl',  draftTeamId:'josh', boardSub:'Tampa Bay',   sub:"NHL · Tampa Bay · '26/'27 Season", accent:'#002868', badgeStyle:'background:#002868; color:#FFFFFF;', badgeText:'TBL',  sportsdbId:'134836' },
  flyers:     { name:'Flyers',      leagueKey:'nhl',  draftTeamId:'josh', boardSub:'Philadelphia', sub:"NHL · Philadelphia · '26/'27 Season", accent:'#F74902', badgeStyle:'background:#F74902; color:#000000;', badgeText:'PHI',  sportsdbId:'134843' },
  redwings:   { name:'Red Wings',   leagueKey:'nhl',  draftTeamId:'josh', boardSub:'Detroit',     sub:"NHL · Detroit · '26/'27 Season",  accent:'#CE1126', badgeStyle:'background:#CE1126; color:#FFFFFF;', badgeText:'DET',  sportsdbId:'134832' },

  cubs:       { name:'Cubs',        leagueKey:'mlb',  draftTeamId:'josh', boardSub:'Chicago',     sub:"MLB · Chicago · '27 Season",      accent:'#0E3386', badgeStyle:'background:#0E3386; color:#CC3433;', badgeText:'CHC',  sportsdbId:'135269' },
  padres:     { name:'Padres',      leagueKey:'mlb',  draftTeamId:'josh', boardSub:'San Diego',   sub:"MLB · San Diego · '27 Season",    accent:'#2F241D', badgeStyle:'background:#2F241D; color:#FFC425;', badgeText:'SD',   sportsdbId:'135278' },
  nationals:  { name:'Nationals',   leagueKey:'mlb',  draftTeamId:'josh', boardSub:'Washington',  sub:"MLB · Washington · '27 Season",   accent:'#AB0003', badgeStyle:'background:#AB0003; color:#FFFFFF;', badgeText:'WSH',  sportsdbId:'135281' },

  valkyries:  { name:'Valkyries',   leagueKey:'wnba', draftTeamId:'josh', boardSub:'Golden State', sub:"WNBA · Golden State · '27 Season", accent:'#8A6BAF', badgeStyle:'background:#000000; color:#8A6BAF;', badgeText:'GSV',  sportsdbId:'150722' },

  oregon:     { name:'Oregon',      leagueKey:'cfb',  draftTeamId:'josh', boardSub:'Ducks',       sub:"College Football · '26 Season",  accent:'#154733', badgeStyle:'background:#154733; color:#FEE123;', badgeText:'ORE',  sportsdbId:'136938', recentLabel:'Results So Far' },
  texasam:    { name:'Texas A&M',   leagueKey:'cfb',  draftTeamId:'josh', boardSub:'Aggies',      sub:"College Football · '26 Season",  accent:'#500000', badgeStyle:'background:#500000; color:#FFFFFF;', badgeText:'A&M',  sportsdbId:'136959', recentLabel:'Results So Far' },
  arizona:    { name:'Arizona',     leagueKey:'cfb',  draftTeamId:'josh', boardSub:'Wildcats',    sub:"College Football · '26 Season",  accent:'#AB0520', badgeStyle:'background:#AB0520; color:#0C234B;', badgeText:'ARIZ', sportsdbId:'136171', recentLabel:'Results So Far' },

  // TheSportsDB doesn't carry a distinct entry for these three
  // schools' basketball programs (only their football teams) —
  // so no live fetch is attempted for them yet.
  houston:    { name:'Houston',     leagueKey:'mcbb', draftTeamId:'josh', boardSub:'Cougars',      sub:'College Basketball · Cougars',      accent:'#C8102E', badgeStyle:'background:#C8102E; color:#FFFFFF;', badgeText:'HOU', sportsdbId:null },
  purdue:     { name:'Purdue',      leagueKey:'mcbb', draftTeamId:'josh', boardSub:'Boilermakers', sub:'College Basketball · Boilermakers', accent:'#000000', badgeStyle:'background:#000000; color:#CEB888;', badgeText:'PUR', sportsdbId:null },
  utahstate:  { name:'Utah State',  leagueKey:'mcbb', draftTeamId:'josh', boardSub:'Aggies',       sub:'College Basketball · Aggies',       accent:'#0F2439', badgeStyle:'background:#0F2439; color:#FFFFFF;', badgeText:'USU', sportsdbId:null },

  // ---- Skeleton: the other 9 drafters' rosters (189 teams) ----
  isaac_arsenal: { name:'Arsenal', leagueKey:'epl', draftTeamId:'isaac', boardSub:'EPL', sub:"EPL · '26/'27 Season", accent:'#3D195B', badgeStyle:'background:#3D195B; color:#FFFFFF;', badgeText:'ARS', sportsdbId:null },
  drew_mancity: { name:'Man City', leagueKey:'epl', draftTeamId:'drew', boardSub:'EPL', sub:"EPL · '26/'27 Season", accent:'#3D195B', badgeStyle:'background:#3D195B; color:#FFFFFF;', badgeText:'MC', sportsdbId:null },
  douglas_everton: { name:'Everton', leagueKey:'epl', draftTeamId:'douglas', boardSub:'EPL', sub:"EPL · '26/'27 Season", accent:'#3D195B', badgeStyle:'background:#3D195B; color:#FFFFFF;', badgeText:'EVE', sportsdbId:null },
  collin_chelsea: { name:'Chelsea', leagueKey:'epl', draftTeamId:'collin', boardSub:'EPL', sub:"EPL · '26/'27 Season", accent:'#3D195B', badgeStyle:'background:#3D195B; color:#FFFFFF;', badgeText:'CHE', sportsdbId:null },
  erichylok_astonvilla: { name:'Aston Villa', leagueKey:'epl', draftTeamId:'erichylok', boardSub:'EPL', sub:"EPL · '26/'27 Season", accent:'#3D195B', badgeStyle:'background:#3D195B; color:#FFFFFF;', badgeText:'AV', sportsdbId:null },
  patrick_manunited: { name:'Man United', leagueKey:'epl', draftTeamId:'patrick', boardSub:'EPL', sub:"EPL · '26/'27 Season", accent:'#3D195B', badgeStyle:'background:#3D195B; color:#FFFFFF;', badgeText:'MU', sportsdbId:null },
  peter_tottenhamhotspur: { name:'Tottenham Hotspur', leagueKey:'epl', draftTeamId:'peter', boardSub:'EPL', sub:"EPL · '26/'27 Season", accent:'#3D195B', badgeStyle:'background:#3D195B; color:#FFFFFF;', badgeText:'TH', sportsdbId:null },
  ericprister_crystalpalace: { name:'Crystal Palace', leagueKey:'epl', draftTeamId:'ericprister', boardSub:'EPL', sub:"EPL · '26/'27 Season", accent:'#3D195B', badgeStyle:'background:#3D195B; color:#FFFFFF;', badgeText:'CP', sportsdbId:null },
  donny_brentford: { name:'Brentford', leagueKey:'epl', draftTeamId:'donny', boardSub:'EPL', sub:"EPL · '26/'27 Season", accent:'#3D195B', badgeStyle:'background:#3D195B; color:#FFFFFF;', badgeText:'BRE', sportsdbId:null },
  isaac_ipswichtown: { name:'Ipswich Town', leagueKey:'epl', draftTeamId:'isaac', boardSub:'EPL', sub:"EPL · '26/'27 Season", accent:'#3D195B', badgeStyle:'background:#3D195B; color:#FFFFFF;', badgeText:'IT', sportsdbId:null },
  drew_hullcity: { name:'Hull City', leagueKey:'epl', draftTeamId:'drew', boardSub:'EPL', sub:"EPL · '26/'27 Season", accent:'#3D195B', badgeStyle:'background:#3D195B; color:#FFFFFF;', badgeText:'HC', sportsdbId:null },
  douglas_fulham: { name:'Fulham', leagueKey:'epl', draftTeamId:'douglas', boardSub:'EPL', sub:"EPL · '26/'27 Season", accent:'#3D195B', badgeStyle:'background:#3D195B; color:#FFFFFF;', badgeText:'FUL', sportsdbId:null },
  collin_leedsunited: { name:'Leeds United', leagueKey:'epl', draftTeamId:'collin', boardSub:'EPL', sub:"EPL · '26/'27 Season", accent:'#3D195B', badgeStyle:'background:#3D195B; color:#FFFFFF;', badgeText:'LU', sportsdbId:null },
  erichylok_nottingham: { name:'Nottingham', leagueKey:'epl', draftTeamId:'erichylok', boardSub:'EPL', sub:"EPL · '26/'27 Season", accent:'#3D195B', badgeStyle:'background:#3D195B; color:#FFFFFF;', badgeText:'NOT', sportsdbId:null },
  patrick_brighton: { name:'Brighton', leagueKey:'epl', draftTeamId:'patrick', boardSub:'EPL', sub:"EPL · '26/'27 Season", accent:'#3D195B', badgeStyle:'background:#3D195B; color:#FFFFFF;', badgeText:'BRI', sportsdbId:null },
  peter_afcbournemouth: { name:'AFC Bournemouth', leagueKey:'epl', draftTeamId:'peter', boardSub:'EPL', sub:"EPL · '26/'27 Season", accent:'#3D195B', badgeStyle:'background:#3D195B; color:#FFFFFF;', badgeText:'AB', sportsdbId:null },
  ericprister_sunderland: { name:'Sunderland', leagueKey:'epl', draftTeamId:'ericprister', boardSub:'EPL', sub:"EPL · '26/'27 Season", accent:'#3D195B', badgeStyle:'background:#3D195B; color:#FFFFFF;', badgeText:'SUN', sportsdbId:null },
  donny_coventrycity: { name:'Coventry City', leagueKey:'epl', draftTeamId:'donny', boardSub:'EPL', sub:"EPL · '26/'27 Season", accent:'#3D195B', badgeStyle:'background:#3D195B; color:#FFFFFF;', badgeText:'CC', sportsdbId:null },
  isaac_eagles: { name:'Eagles', leagueKey:'nfl', draftTeamId:'isaac', boardSub:'NFL', sub:"NFL · '26 Season", accent:'#013369', badgeStyle:'background:#013369; color:#FFFFFF;', badgeText:'EAG', sportsdbId:null },
  drew_chiefs: { name:'Chiefs', leagueKey:'nfl', draftTeamId:'drew', boardSub:'NFL', sub:"NFL · '26 Season", accent:'#013369', badgeStyle:'background:#013369; color:#FFFFFF;', badgeText:'CHI', sportsdbId:null },
  douglas_texans: { name:'Texans', leagueKey:'nfl', draftTeamId:'douglas', boardSub:'NFL', sub:"NFL · '26 Season", accent:'#013369', badgeStyle:'background:#013369; color:#FFFFFF;', badgeText:'TEX', sportsdbId:null },
  collin_seahawks: { name:'Seahawks', leagueKey:'nfl', draftTeamId:'collin', boardSub:'NFL', sub:"NFL · '26 Season", accent:'#013369', badgeStyle:'background:#013369; color:#FFFFFF;', badgeText:'SEA', sportsdbId:null },
  erichylok_49ers: { name:'49ers', leagueKey:'nfl', draftTeamId:'erichylok', boardSub:'NFL', sub:"NFL · '26 Season", accent:'#013369', badgeStyle:'background:#013369; color:#FFFFFF;', badgeText:'49E', sportsdbId:null },
  patrick_ravens: { name:'Ravens', leagueKey:'nfl', draftTeamId:'patrick', boardSub:'NFL', sub:"NFL · '26 Season", accent:'#013369', badgeStyle:'background:#013369; color:#FFFFFF;', badgeText:'RAV', sportsdbId:null },
  peter_broncos: { name:'Broncos', leagueKey:'nfl', draftTeamId:'peter', boardSub:'NFL', sub:"NFL · '26 Season", accent:'#013369', badgeStyle:'background:#013369; color:#FFFFFF;', badgeText:'BRO', sportsdbId:null },
  ericprister_rams: { name:'Rams', leagueKey:'nfl', draftTeamId:'ericprister', boardSub:'NFL', sub:"NFL · '26 Season", accent:'#013369', badgeStyle:'background:#013369; color:#FFFFFF;', badgeText:'RAM', sportsdbId:null },
  donny_bucs: { name:'Bucs', leagueKey:'nfl', draftTeamId:'donny', boardSub:'NFL', sub:"NFL · '26 Season", accent:'#013369', badgeStyle:'background:#013369; color:#FFFFFF;', badgeText:'BUC', sportsdbId:null },
  isaac_patriots: { name:'Patriots', leagueKey:'nfl', draftTeamId:'isaac', boardSub:'NFL', sub:"NFL · '26 Season", accent:'#013369', badgeStyle:'background:#013369; color:#FFFFFF;', badgeText:'PAT', sportsdbId:null },
  drew_bengals: { name:'Bengals', leagueKey:'nfl', draftTeamId:'drew', boardSub:'NFL', sub:"NFL · '26 Season", accent:'#013369', badgeStyle:'background:#013369; color:#FFFFFF;', badgeText:'BEN', sportsdbId:null },
  douglas_falcons: { name:'Falcons', leagueKey:'nfl', draftTeamId:'douglas', boardSub:'NFL', sub:"NFL · '26 Season", accent:'#013369', badgeStyle:'background:#013369; color:#FFFFFF;', badgeText:'FAL', sportsdbId:null },
  collin_giants: { name:'Giants', leagueKey:'nfl', draftTeamId:'collin', boardSub:'NFL', sub:"NFL · '26 Season", accent:'#013369', badgeStyle:'background:#013369; color:#FFFFFF;', badgeText:'GIA', sportsdbId:null },
  erichylok_packers: { name:'Packers', leagueKey:'nfl', draftTeamId:'erichylok', boardSub:'NFL', sub:"NFL · '26 Season", accent:'#013369', badgeStyle:'background:#013369; color:#FFFFFF;', badgeText:'PAC', sportsdbId:null },
  patrick_colts: { name:'Colts', leagueKey:'nfl', draftTeamId:'patrick', boardSub:'NFL', sub:"NFL · '26 Season", accent:'#013369', badgeStyle:'background:#013369; color:#FFFFFF;', badgeText:'COL', sportsdbId:null },
  peter_jaguars: { name:'Jaguars', leagueKey:'nfl', draftTeamId:'peter', boardSub:'NFL', sub:"NFL · '26 Season", accent:'#013369', badgeStyle:'background:#013369; color:#FFFFFF;', badgeText:'JAG', sportsdbId:null },
  ericprister_bills: { name:'Bills', leagueKey:'nfl', draftTeamId:'ericprister', boardSub:'NFL', sub:"NFL · '26 Season", accent:'#013369', badgeStyle:'background:#013369; color:#FFFFFF;', badgeText:'BIL', sportsdbId:null },
  donny_vikings: { name:'Vikings', leagueKey:'nfl', draftTeamId:'donny', boardSub:'NFL', sub:"NFL · '26 Season", accent:'#013369', badgeStyle:'background:#013369; color:#FFFFFF;', badgeText:'VIK', sportsdbId:null },
  isaac_titans: { name:'Titans', leagueKey:'nfl', draftTeamId:'isaac', boardSub:'NFL', sub:"NFL · '26 Season", accent:'#013369', badgeStyle:'background:#013369; color:#FFFFFF;', badgeText:'TIT', sportsdbId:null },
  drew_bears: { name:'Bears', leagueKey:'nfl', draftTeamId:'drew', boardSub:'NFL', sub:"NFL · '26 Season", accent:'#013369', badgeStyle:'background:#013369; color:#FFFFFF;', badgeText:'BEA', sportsdbId:null },
  douglas_commanders: { name:'Commanders', leagueKey:'nfl', draftTeamId:'douglas', boardSub:'NFL', sub:"NFL · '26 Season", accent:'#013369', badgeStyle:'background:#013369; color:#FFFFFF;', badgeText:'COM', sportsdbId:null },
  collin_raiders: { name:'Raiders', leagueKey:'nfl', draftTeamId:'collin', boardSub:'NFL', sub:"NFL · '26 Season", accent:'#013369', badgeStyle:'background:#013369; color:#FFFFFF;', badgeText:'RAI', sportsdbId:null },
  erichylok_cowboys: { name:'Cowboys', leagueKey:'nfl', draftTeamId:'erichylok', boardSub:'NFL', sub:"NFL · '26 Season", accent:'#013369', badgeStyle:'background:#013369; color:#FFFFFF;', badgeText:'COW', sportsdbId:null },
  patrick_saints: { name:'Saints', leagueKey:'nfl', draftTeamId:'patrick', boardSub:'NFL', sub:"NFL · '26 Season", accent:'#013369', badgeStyle:'background:#013369; color:#FFFFFF;', badgeText:'SAI', sportsdbId:null },
  peter_panthers: { name:'Panthers', leagueKey:'nfl', draftTeamId:'peter', boardSub:'NFL', sub:"NFL · '26 Season", accent:'#013369', badgeStyle:'background:#013369; color:#FFFFFF;', badgeText:'PAN', sportsdbId:null },
  ericprister_chargers: { name:'Chargers', leagueKey:'nfl', draftTeamId:'ericprister', boardSub:'NFL', sub:"NFL · '26 Season", accent:'#013369', badgeStyle:'background:#013369; color:#FFFFFF;', badgeText:'CHA', sportsdbId:null },
  donny_jets: { name:'Jets', leagueKey:'nfl', draftTeamId:'donny', boardSub:'NFL', sub:"NFL · '26 Season", accent:'#013369', badgeStyle:'background:#013369; color:#FFFFFF;', badgeText:'JET', sportsdbId:null },
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
  isaac_ohiostate: { name:'Ohio State', leagueKey:'cfb', draftTeamId:'isaac', boardSub:'College FB', sub:"College FB · '26 Season", accent:'#013220', badgeStyle:'background:#013220; color:#FFFFFF;', badgeText:'OS', sportsdbId:null },
  drew_georgia: { name:'Georgia', leagueKey:'cfb', draftTeamId:'drew', boardSub:'College FB', sub:"College FB · '26 Season", accent:'#013220', badgeStyle:'background:#013220; color:#FFFFFF;', badgeText:'GEO', sportsdbId:null },
  douglas_miami: { name:'Miami', leagueKey:'cfb', draftTeamId:'douglas', boardSub:'College FB', sub:"College FB · '26 Season", accent:'#013220', badgeStyle:'background:#013220; color:#FFFFFF;', badgeText:'MIA', sportsdbId:null },
  collin_washington: { name:'Washington', leagueKey:'cfb', draftTeamId:'collin', boardSub:'College FB', sub:"College FB · '26 Season", accent:'#013220', badgeStyle:'background:#013220; color:#FFFFFF;', badgeText:'WAS', sportsdbId:null },
  erichylok_usc: { name:'USC', leagueKey:'cfb', draftTeamId:'erichylok', boardSub:'College FB', sub:"College FB · '26 Season", accent:'#013220', badgeStyle:'background:#013220; color:#FFFFFF;', badgeText:'USC', sportsdbId:null },
  patrick_liberty: { name:'Liberty', leagueKey:'cfb', draftTeamId:'patrick', boardSub:'College FB', sub:"College FB · '26 Season", accent:'#013220', badgeStyle:'background:#013220; color:#FFFFFF;', badgeText:'LIB', sportsdbId:null },
  peter_texas: { name:'Texas', leagueKey:'cfb', draftTeamId:'peter', boardSub:'College FB', sub:"College FB · '26 Season", accent:'#013220', badgeStyle:'background:#013220; color:#FFFFFF;', badgeText:'TEX', sportsdbId:null },
  ericprister_oklahoma: { name:'Oklahoma', leagueKey:'cfb', draftTeamId:'ericprister', boardSub:'College FB', sub:"College FB · '26 Season", accent:'#013220', badgeStyle:'background:#013220; color:#FFFFFF;', badgeText:'OKL', sportsdbId:null },
  donny_texastech: { name:'Texas Tech', leagueKey:'cfb', draftTeamId:'donny', boardSub:'College FB', sub:"College FB · '26 Season", accent:'#013220', badgeStyle:'background:#013220; color:#FFFFFF;', badgeText:'TT', sportsdbId:null },
  isaac_notredame: { name:'Notre Dame', leagueKey:'cfb', draftTeamId:'isaac', boardSub:'College FB', sub:"College FB · '26 Season", accent:'#013220', badgeStyle:'background:#013220; color:#FFFFFF;', badgeText:'ND', sportsdbId:null },
  drew_pennstate: { name:'Penn State', leagueKey:'cfb', draftTeamId:'drew', boardSub:'College FB', sub:"College FB · '26 Season", accent:'#013220', badgeStyle:'background:#013220; color:#FFFFFF;', badgeText:'PS', sportsdbId:null },
  douglas_lsu: { name:'LSU', leagueKey:'cfb', draftTeamId:'douglas', boardSub:'College FB', sub:"College FB · '26 Season", accent:'#013220', badgeStyle:'background:#013220; color:#FFFFFF;', badgeText:'LSU', sportsdbId:null },
  collin_toledo: { name:'Toledo', leagueKey:'cfb', draftTeamId:'collin', boardSub:'College FB', sub:"College FB · '26 Season", accent:'#013220', badgeStyle:'background:#013220; color:#FFFFFF;', badgeText:'TOL', sportsdbId:null },
  erichylok_smu: { name:'SMU', leagueKey:'cfb', draftTeamId:'erichylok', boardSub:'College FB', sub:"College FB · '26 Season", accent:'#013220', badgeStyle:'background:#013220; color:#FFFFFF;', badgeText:'SMU', sportsdbId:null },
  patrick_westernmichigan: { name:'Western Michigan', leagueKey:'cfb', draftTeamId:'patrick', boardSub:'College FB', sub:"College FB · '26 Season", accent:'#013220', badgeStyle:'background:#013220; color:#FFFFFF;', badgeText:'WM', sportsdbId:null },
  peter_iu: { name:'IU', leagueKey:'cfb', draftTeamId:'peter', boardSub:'College FB', sub:"College FB · '26 Season", accent:'#013220', badgeStyle:'background:#013220; color:#FFFFFF;', badgeText:'IU', sportsdbId:null },
  ericprister_jamesmadison: { name:'James Madison', leagueKey:'cfb', draftTeamId:'ericprister', boardSub:'College FB', sub:"College FB · '26 Season", accent:'#013220', badgeStyle:'background:#013220; color:#FFFFFF;', badgeText:'JM', sportsdbId:null },
  donny_newmexico: { name:'New Mexico', leagueKey:'cfb', draftTeamId:'donny', boardSub:'College FB', sub:"College FB · '26 Season", accent:'#013220', badgeStyle:'background:#013220; color:#FFFFFF;', badgeText:'NM', sportsdbId:null },
  isaac_boisestate: { name:'Boise State', leagueKey:'cfb', draftTeamId:'isaac', boardSub:'College FB', sub:"College FB · '26 Season", accent:'#013220', badgeStyle:'background:#013220; color:#FFFFFF;', badgeText:'BS', sportsdbId:null },
  drew_ndsu: { name:'NDSU', leagueKey:'cfb', draftTeamId:'drew', boardSub:'College FB', sub:"College FB · '26 Season", accent:'#013220', badgeStyle:'background:#013220; color:#FFFFFF;', badgeText:'NDS', sportsdbId:null },
  douglas_houston: { name:'Houston', leagueKey:'cfb', draftTeamId:'douglas', boardSub:'College FB', sub:"College FB · '26 Season", accent:'#013220', badgeStyle:'background:#013220; color:#FFFFFF;', badgeText:'HOU', sportsdbId:null },
  collin_olemiss: { name:'Ole Miss', leagueKey:'cfb', draftTeamId:'collin', boardSub:'College FB', sub:"College FB · '26 Season", accent:'#013220', badgeStyle:'background:#013220; color:#FFFFFF;', badgeText:'OM', sportsdbId:null },
  erichylok_byu: { name:'BYU', leagueKey:'cfb', draftTeamId:'erichylok', boardSub:'College FB', sub:"College FB · '26 Season", accent:'#013220', badgeStyle:'background:#013220; color:#FFFFFF;', badgeText:'BYU', sportsdbId:null },
  patrick_navy: { name:'Navy', leagueKey:'cfb', draftTeamId:'patrick', boardSub:'College FB', sub:"College FB · '26 Season", accent:'#013220', badgeStyle:'background:#013220; color:#FFFFFF;', badgeText:'NAV', sportsdbId:null },
  peter_virginia: { name:'Virginia', leagueKey:'cfb', draftTeamId:'peter', boardSub:'College FB', sub:"College FB · '26 Season", accent:'#013220', badgeStyle:'background:#013220; color:#FFFFFF;', badgeText:'VIR', sportsdbId:null },
  ericprister_memphis: { name:'Memphis', leagueKey:'cfb', draftTeamId:'ericprister', boardSub:'College FB', sub:"College FB · '26 Season", accent:'#013220', badgeStyle:'background:#013220; color:#FFFFFF;', badgeText:'MEM', sportsdbId:null },
  donny_louisville: { name:'Louisville', leagueKey:'cfb', draftTeamId:'donny', boardSub:'College FB', sub:"College FB · '26 Season", accent:'#013220', badgeStyle:'background:#013220; color:#FFFFFF;', badgeText:'LOU', sportsdbId:null },
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
const LEAGUES = [
  { key:'epl', label:'EPL', season:"'26/'27 Season", teams:['isaac_arsenal', 'drew_mancity', 'douglas_everton', 'collin_chelsea', 'erichylok_astonvilla', 'liverpool', 'patrick_manunited', 'peter_tottenhamhotspur', 'ericprister_crystalpalace', 'donny_brentford', 'isaac_ipswichtown', 'drew_hullcity', 'douglas_fulham', 'collin_leedsunited', 'erichylok_nottingham', 'newcastle', 'patrick_brighton', 'peter_afcbournemouth', 'ericprister_sunderland', 'donny_coventrycity'] },
  { key:'cfb', label:'College FB', season:"'26 Season", teams:['isaac_ohiostate', 'drew_georgia', 'douglas_miami', 'collin_washington', 'erichylok_usc', 'oregon', 'patrick_liberty', 'peter_texas', 'ericprister_oklahoma', 'donny_texastech', 'isaac_notredame', 'drew_pennstate', 'douglas_lsu', 'collin_toledo', 'erichylok_smu', 'texasam', 'patrick_westernmichigan', 'peter_iu', 'ericprister_jamesmadison', 'donny_newmexico', 'isaac_boisestate', 'drew_ndsu', 'douglas_houston', 'collin_olemiss', 'erichylok_byu', 'arizona', 'patrick_navy', 'peter_virginia', 'ericprister_memphis', 'donny_louisville'] },
  { key:'nfl', label:'NFL', season:"'26 Season", teams:['isaac_eagles', 'drew_chiefs', 'douglas_texans', 'collin_seahawks', 'erichylok_49ers', 'lions', 'patrick_ravens', 'peter_broncos', 'ericprister_rams', 'donny_bucs', 'isaac_patriots', 'drew_bengals', 'douglas_falcons', 'collin_giants', 'erichylok_packers', 'steelers', 'patrick_colts', 'peter_jaguars', 'ericprister_bills', 'donny_vikings', 'isaac_titans', 'drew_bears', 'douglas_commanders', 'collin_raiders', 'erichylok_cowboys', 'dolphins', 'patrick_saints', 'peter_panthers', 'ericprister_chargers', 'donny_jets'] },
  { key:'mcbb', label:'College BB', season:"'26/'27 Season", teams:['isaac_uconn', 'drew_michigan', 'douglas_duke', 'collin_arizona', 'erichylok_kansas', 'houston', 'patrick_illinois', 'peter_michstate', 'ericprister_iowastate', 'donny_florida', 'isaac_tennessee', 'drew_alabama', 'douglas_texas', 'collin_stjohns', 'erichylok_virginia', 'purdue', 'patrick_kentucky', 'peter_arkansas', 'ericprister_vanderbilt', 'donny_saintmarys', 'isaac_miami', 'drew_gonzaga', 'douglas_texastech', 'collin_northcarolina', 'erichylok_nebraska', 'utahstate', 'patrick_ndsu', 'peter_slu', 'ericprister_georgia', 'donny_louisville_cbb'] },
  { key:'nba', label:'NBA', season:"'26/'27 Season", teams:['isaac_raptors', 'drew_knicks', 'douglas_76ers', 'collin_blazers', 'erichylok_celtics', 'cavaliers', 'patrick_spurs', 'peter_pacers', 'ericprister_hawks', 'donny_thunder', 'isaac_bulls', 'drew_warriors', 'douglas_rockets', 'collin_nets', 'erichylok_timberwolves', 'nuggets', 'patrick_heat', 'peter_jazz', 'ericprister_clippers', 'donny_pistons', 'isaac_pelicans', 'drew_bucks', 'douglas_hornets', 'collin_kings', 'erichylok_suns', 'mavericks', 'patrick_magic', 'peter_wizards', 'ericprister_grizzlies', 'donny_lakers'] },
  { key:'nhl', label:'NHL', season:"'26/'27 Season", teams:['isaac_ducks', 'drew_stars', 'douglas_mammoth', 'collin_hurricanes', 'erichylok_jets', 'lightning', 'patrick_oilers', 'peter_goldenknights', 'ericprister_panthers', 'donny_capitals', 'isaac_sabres', 'drew_senators', 'douglas_predators', 'collin_canadiens', 'erichylok_kraken', 'flyers', 'patrick_sharks', 'peter_devils', 'ericprister_avalanche', 'donny_kings', 'isaac_bluejackets', 'drew_islanders', 'douglas_blues', 'collin_mapleleafs', 'erichylok_canucks', 'redwings', 'patrick_rangers', 'peter_bruins', 'ericprister_wild', 'donny_penguins'] },
  { key:'mlb', label:'MLB', season:"'27 Season", teams:['isaac_yankees', 'drew_brewers', 'douglas_bluejays', 'collin_dodgers', 'erichylok_braves', 'cubs', 'patrick_twins', 'peter_orioles', 'ericprister_rays', 'donny_tigers', 'isaac_guardians', 'drew_whitesox', 'douglas_marlins', 'collin_redsox', 'erichylok_astros', 'padres', 'patrick_athletics', 'peter_royals', 'ericprister_diamondbacks', 'donny_mariners', 'isaac_mets', 'drew_rockies', 'douglas_pirates', 'collin_phillies', 'erichylok_rangers', 'nationals', 'patrick_reds', 'peter_angels', 'ericprister_cardinals', 'donny_giants'] },
  { key:'wnba', label:'WNBA', season:"'27 Season", teams:['isaac_mercury', 'drew_sky', 'douglas_lynx', 'collin_dream', 'erichylok_liberty', 'valkyries', 'patrick_wings', 'peter_aces', 'ericprister_mystics', 'donny_fever'] }
];

const LEAGUE_SCORING = {
  epl: {
    name: 'EPL',
    full: 'Premier League Scoring',
    accent: '#3D195B',
    rules: [
      { label: 'Win League Cup', pts: 1 },
      { label: 'Win FA Cup', pts: 2 },
      { label: 'Make Europa League', pts: 3 },
      { label: 'Make Champions League (any stage)', pts: 4 },
      { label: '3rd in EPL', pts: 3 },
      { label: '2nd in EPL', pts: 6 },
      { label: 'Win EPL', pts: 9 },
      { label: 'Relegation', pts: -5 }
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
      { label: 'Make conference finals', pts: 2 },
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
