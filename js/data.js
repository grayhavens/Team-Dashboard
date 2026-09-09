/* ============================================================
   Board content: leagues, teams, and scoring rules.
   This is the file to edit when adding/removing a team or league
   — everything else in js/app.js just reads from these objects.
   ============================================================ */

// Static look/labels for every team, plus (where available) its
// TheSportsDB team ID so we can pull live results. Teams with
// sportsdbId: null don't have reliable live coverage yet (see
// College Basketball below) and fall back to a plain notice.
// leagueKey links each team to its LEAGUE_SCORING entry below.
const TEAM_META = {
  liverpool:  { name:'Liverpool',   leagueKey:'epl',  boardSub:'Premier League', sub:"Premier League · '26/'27 Season", accent:'#C8102E', badgeStyle:'background:#C8102E; color:#F6EB61;', badgeText:'LFC',  sportsdbId:'133602', leagueId:'4328', season:'2026-2027' },
  newcastle:  { name:'Newcastle',   leagueKey:'epl',  boardSub:'Premier League', sub:"Premier League · '26/'27 Season", accent:'#241F20', badgeStyle:'background:#241F20; color:#FFFFFF;', badgeText:'NUFC', sportsdbId:'134777', leagueId:'4328', season:'2026-2027' },

  lions:      { name:'Lions',       leagueKey:'nfl',  boardSub:'Detroit',     sub:"NFL · Detroit · '26 Season",     accent:'#0076B6', badgeStyle:'background:#0076B6; color:#B0B7BC;', badgeText:'DET',  sportsdbId:'134939' },
  steelers:   { name:'Steelers',    leagueKey:'nfl',  boardSub:'Pittsburgh',  sub:"NFL · Pittsburgh · '26 Season",  accent:'#101820', badgeStyle:'background:#101820; color:#FFB612;', badgeText:'PIT',  sportsdbId:'134925' },
  dolphins:   { name:'Dolphins',    leagueKey:'nfl',  boardSub:'Miami',       sub:"NFL · Miami · '26 Season",       accent:'#008E97', badgeStyle:'background:#008E97; color:#F58220;', badgeText:'MIA',  sportsdbId:'134919' },

  cavaliers:  { name:'Cavaliers',   leagueKey:'nba',  boardSub:'Cleveland',   sub:"NBA · Cleveland · '26/'27 Season", accent:'#860038', badgeStyle:'background:#860038; color:#FDBB30;', badgeText:'CLE',  sportsdbId:'134871' },
  nuggets:    { name:'Nuggets',     leagueKey:'nba',  boardSub:'Denver',      sub:"NBA · Denver · '26/'27 Season",   accent:'#0E2240', badgeStyle:'background:#0E2240; color:#FEC524;', badgeText:'DEN',  sportsdbId:'134885' },
  mavericks:  { name:'Mavs',        leagueKey:'nba',  boardSub:'Dallas',      sub:"NBA · Dallas · '26/'27 Season",   accent:'#00538C', badgeStyle:'background:#00538C; color:#B8C4CA;', badgeText:'DAL',  sportsdbId:'134875' },

  lightning:  { name:'Lightning',   leagueKey:'nhl',  boardSub:'Tampa Bay',   sub:"NHL · Tampa Bay · '26/'27 Season", accent:'#002868', badgeStyle:'background:#002868; color:#FFFFFF;', badgeText:'TBL',  sportsdbId:'134836' },
  flyers:     { name:'Flyers',      leagueKey:'nhl',  boardSub:'Philadelphia', sub:"NHL · Philadelphia · '26/'27 Season", accent:'#F74902', badgeStyle:'background:#F74902; color:#000000;', badgeText:'PHI',  sportsdbId:'134843' },
  redwings:   { name:'Red Wings',   leagueKey:'nhl',  boardSub:'Detroit',     sub:"NHL · Detroit · '26/'27 Season",  accent:'#CE1126', badgeStyle:'background:#CE1126; color:#FFFFFF;', badgeText:'DET',  sportsdbId:'134832' },

  cubs:       { name:'Cubs',        leagueKey:'mlb',  boardSub:'Chicago',     sub:"MLB · Chicago · '27 Season",      accent:'#0E3386', badgeStyle:'background:#0E3386; color:#CC3433;', badgeText:'CHC',  sportsdbId:'135269' },
  padres:     { name:'Padres',      leagueKey:'mlb',  boardSub:'San Diego',   sub:"MLB · San Diego · '27 Season",    accent:'#2F241D', badgeStyle:'background:#2F241D; color:#FFC425;', badgeText:'SD',   sportsdbId:'135278' },
  nationals:  { name:'Nationals',   leagueKey:'mlb',  boardSub:'Washington',  sub:"MLB · Washington · '27 Season",   accent:'#AB0003', badgeStyle:'background:#AB0003; color:#FFFFFF;', badgeText:'WSH',  sportsdbId:'135281' },

  valkyries:  { name:'Valkyries',   leagueKey:'wnba', boardSub:'Golden State', sub:"WNBA · Golden State · '27 Season", accent:'#8A6BAF', badgeStyle:'background:#000000; color:#8A6BAF;', badgeText:'GSV',  sportsdbId:'150722' },

  oregon:     { name:'Oregon',      leagueKey:'cfb',  boardSub:'Ducks',       sub:"College Football · '26 Season",  accent:'#154733', badgeStyle:'background:#154733; color:#FEE123;', badgeText:'ORE',  sportsdbId:'136938', recentLabel:'Results So Far' },
  texasam:    { name:'Texas A&M',   leagueKey:'cfb',  boardSub:'Aggies',      sub:"College Football · '26 Season",  accent:'#500000', badgeStyle:'background:#500000; color:#FFFFFF;', badgeText:'A&M',  sportsdbId:'136959', recentLabel:'Results So Far' },
  arizona:    { name:'Arizona',     leagueKey:'cfb',  boardSub:'Wildcats',    sub:"College Football · '26 Season",  accent:'#AB0520', badgeStyle:'background:#AB0520; color:#0C234B;', badgeText:'ARIZ', sportsdbId:'136171', recentLabel:'Results So Far' },

  // TheSportsDB doesn't carry a distinct entry for these three
  // schools' basketball programs (only their football teams) —
  // so no live fetch is attempted for them yet.
  houston:    { name:'Houston',     leagueKey:'mcbb', boardSub:'Cougars',      sub:'College Basketball · Cougars',      accent:'#C8102E', badgeStyle:'background:#C8102E; color:#FFFFFF;', badgeText:'HOU', sportsdbId:null },
  purdue:     { name:'Purdue',      leagueKey:'mcbb', boardSub:'Boilermakers', sub:'College Basketball · Boilermakers', accent:'#000000', badgeStyle:'background:#000000; color:#CEB888;', badgeText:'PUR', sportsdbId:null },
  utahstate:  { name:'Utah State',  leagueKey:'mcbb', boardSub:'Aggies',       sub:'College Basketball · Aggies',       accent:'#0F2439', badgeStyle:'background:#0F2439; color:#FFFFFF;', badgeText:'USU', sportsdbId:null }
};

// Board order: which teams appear under each league tab, and the
// season label shown next to the league name.
const LEAGUES = [
  { key:'epl',  label:'EPL',        season:"'26/'27 Season", teams:['liverpool','newcastle'] },
  { key:'nfl',  label:'NFL',        season:"'26 Season",     teams:['lions','steelers','dolphins'] },
  { key:'nba',  label:'NBA',        season:"'26/'27 Season", teams:['cavaliers','nuggets','mavericks'] },
  { key:'nhl',  label:'NHL',        season:"'26/'27 Season", teams:['lightning','flyers','redwings'] },
  { key:'mlb',  label:'MLB',        season:"'27 Season",     teams:['cubs','padres','nationals'] },
  { key:'wnba', label:'WNBA',       season:"'27 Season",     teams:['valkyries'] },
  { key:'cfb',  label:'College FB', season:"'26 Season",     teams:['oregon','texasam','arizona'] },
  { key:'mcbb', label:'College BB', season:"'26/'27 Season", teams:['houston','purdue','utahstate'] }
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
    ]
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
    ]
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
    ]
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
    ]
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
    ]
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
    ]
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
    ]
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
    ]
  }
};
