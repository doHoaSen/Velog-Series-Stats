// .github/traffic-data/{views,clones}.json에 누적된 일별 기록을 모두 합산해
// README에 임베드할 "누적 조회수 / 누적 클론수" 스탯 카드 SVG를 생성한다.
// 일별 추이는 굳이 공개할 필요가 없다는 판단으로, 그래프 대신 총합 두 개만 보여준다.
// 라이트/다크 두 벌을 만드는 이유: GitHub README는 <picture>의
// prefers-color-scheme 미디어 쿼리로 뷰어 테마에 맞는 이미지를 골라 보여주므로,
// 자동 반전이 아니라 각 테마 표면에 맞게 검증된 색을 그대로 쓴다.
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = ".github/traffic-data";

const THEMES = {
  light: {
    surface: "#fcfcfb",
    primaryInk: "#0b0b0b",
    secondaryInk: "#52514e",
    mutedInk: "#898781",
    border: "rgba(11,11,11,0.10)",
    divider: "#e1e0d9",
    views: "#2a78d6",
    clones: "#eb6834",
  },
  dark: {
    surface: "#1a1a19",
    primaryInk: "#ffffff",
    secondaryInk: "#c3c2b7",
    mutedInk: "#898781",
    border: "rgba(255,255,255,0.10)",
    divider: "#2c2c2a",
    views: "#3987e5",
    clones: "#d95926",
  },
};

function readSeries(fileName) {
  const filePath = path.join(DATA_DIR, fileName);
  if (!fs.existsSync(filePath)) return {};
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sumCounts(data) {
  return Object.values(data).reduce((sum, day) => sum + (day.count ?? 0), 0);
}

// 큰 값에서 카드 폭을 넘기지 않도록, 1만 이상은 12.9K 같은 축약 표기를 쓴다.
function formatNumber(value) {
  if (value >= 10000) {
    return new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  }
  return value.toLocaleString("ko-KR");
}

function buildSvg({ totalViews, totalClones, since, updatedAt }, colors) {
  const width = 480;
  const height = 170;
  const dividerX = width / 2;
  const col1X = 32;
  const col2X = dividerX + 32;

  function statBlock(x, color, label, value) {
    return `<circle cx="${x + 4}" cy="36" r="4" fill="${color}" />
<text x="${x + 16}" y="40" font-size="13" fill="${colors.secondaryInk}">${label}</text>
<text x="${x}" y="100" font-size="40" font-weight="700" fill="${colors.primaryInk}">${formatNumber(value)}</text>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
<title>GitHub 저장소 누적 트래픽</title>
<desc>${since}부터 누적된 총 조회수와 총 클론수 (마지막 갱신 ${updatedAt})</desc>
<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="10" fill="${colors.surface}" stroke="${colors.border}" />
<line x1="${dividerX}" y1="28" x2="${dividerX}" y2="${height - 32}" stroke="${colors.divider}" stroke-width="1" />
${statBlock(col1X, colors.views, "총 조회수", totalViews)}
${statBlock(col2X, colors.clones, "총 클론수", totalClones)}
<text x="${width / 2}" y="${height - 16}" text-anchor="middle" font-size="11" fill="${colors.mutedInk}">${since}부터 누적 · 마지막 갱신 ${updatedAt}</text>
</svg>
`;
}

function main() {
  const viewsData = readSeries("views.json");
  const clonesData = readSeries("clones.json");
  const dates = [...new Set([...Object.keys(viewsData), ...Object.keys(clonesData)])].sort();

  if (dates.length === 0) {
    console.log("트래픽 데이터가 없어 스탯 카드 생성을 건너뜁니다.");
    return;
  }

  const stats = {
    totalViews: sumCounts(viewsData),
    totalClones: sumCounts(clonesData),
    since: dates[0],
    updatedAt: dates[dates.length - 1],
  };

  for (const [theme, colors] of Object.entries(THEMES)) {
    const svg = buildSvg(stats, colors);
    fs.writeFileSync(path.join(DATA_DIR, `traffic-stats-${theme}.svg`), svg);
  }
  console.log(`스탯 카드 생성 완료 (누적 조회수 ${stats.totalViews}, 누적 클론수 ${stats.totalClones}).`);
}

main();
