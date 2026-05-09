import { writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const PUBMED_SEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const PUBMED_FETCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";
const EBI_SEARCH = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";

const JOURNALS = [
  "International Journal of Eating Disorders",
  "European Eating Disorders Review",
  "Journal of Eating Disorders",
  "Eating and Weight Disorders",
  "Body Image",
  "Appetite",
  "Nutrients",
  "Psychological Medicine",
  "JAMA Psychiatry",
  "The Lancet Psychiatry",
  "American Journal of Psychiatry",
  "Biological Psychiatry",
  "Molecular Psychiatry",
  "Translational Psychiatry",
  "Behaviour Research and Therapy",
  "Journal of Child Psychology and Psychiatry",
  "Neuropsychopharmacology",
  "Addiction",
  "British Journal of Sports Medicine",
  "Sports Medicine",
];

const CORE_QUERY = '("Bulimia Nervosa"[Mesh] OR "bulimia nervosa"[tiab] OR bulimia[tiab] OR "binge-purge"[tiab])';

function curlGet(url, timeoutMs = 30000) {
  const sec = Math.ceil(timeoutMs / 1000);
  return execSync(
    `curl -sS -L --max-time ${sec} -H "User-Agent: BNBot/1.0" -- "${url}"`,
    { encoding: "utf-8", timeout: timeoutMs + 5000, maxBuffer: 10 * 1024 * 1024 }
  );
}

function dateFilter(days) {
  const d = new Date(Date.now() - days * 86400000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `"${y}/${m}/${day}"[Date - Publication] : "3000"[Date - Publication]`;
}

function buildJournalQuery(days) {
  const jp = JOURNALS.slice(0, 10).map((j) => `"${j}"[Journal]`).join(" OR ");
  return `(${CORE_QUERY}) AND (${jp}) AND ${dateFilter(days)}`;
}

function buildBroadQuery(days) {
  return `(${CORE_QUERY}) AND ${dateFilter(days)}`;
}

function searchPubMed(query, retmax) {
  const url = `${PUBMED_SEARCH}?db=pubmed&term=${encodeURIComponent(query)}&retmax=${retmax}&sort=date&retmode=json`;
  const text = curlGet(url, 30000);
  if (text.trim().startsWith("<!")) throw new Error("PubMed HTML error");
  const data = JSON.parse(text);
  return (data?.esearchresult?.idlist || []);
}

function fetchPubMedDetails(pmids) {
  if (!pmids.length) return [];
  const url = `${PUBMED_FETCH}?db=pubmed&id=${pmids.join(",")}&retmode=xml`;
  const xml = curlGet(url, 60000);
  if (xml.trim().startsWith("<!DOCTYPE html")) throw new Error("PubMed fetch HTML error");
  const papers = [];
  const re = /<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const b = m[1];
    const titleM = b.match(/<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/);
    const pmidM = b.match(/<PMID[^>]*>(\d+)<\/PMID>/);
    const journalM = b.match(/<Title>([\s\S]*?)<\/Title>/);
    const absParts = [];
    const absRe = /<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g;
    let am;
    while ((am = absRe.exec(b)) !== null) {
      const lbl = (am[0].match(/Label="([^"]*)"/) || [])[1] || "";
      const txt = am[1].replace(/<[^>]+>/g, "").trim();
      if (txt) absParts.push(lbl ? `${lbl}: ${txt}` : txt);
    }
    const kwList = [];
    const kwRe = /<Keyword>([\s\S]*?)<\/Keyword>/g;
    let kw;
    while ((kw = kwRe.exec(b)) !== null) if (kw[1].trim()) kwList.push(kw[1].trim());
    const pmid = pmidM?.[1] || "";
    papers.push({
      pmid,
      title: titleM ? titleM[1].replace(/<[^>]+>/g, "").trim() : "",
      journal: journalM?.[1]?.trim() || "",
      date: [b.match(/<Year>(\d{4})<\/Year>/)?.[1], b.match(/<Month>([^<]+)<\/Month>/)?.[1], b.match(/<Day>(\d+)<\/Day>/)?.[1]].filter(Boolean).join(" "),
      abstract: absParts.join(" ").slice(0, 2000),
      url: pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : "",
      keywords: kwList,
    });
  }
  return papers;
}

function searchEuropePMC(query, pageSize = 50) {
  const url = `${EBI_SEARCH}?query=${encodeURIComponent(query)}&format=json&pageSize=${pageSize}&sort=PUB_DATE desc`;
  const text = curlGet(url, 30000);
  const data = JSON.parse(text);
  const results = data?.resultList?.result || [];
  return results.map((r) => ({
    pmid: r.pmid || "",
    title: r.title || "",
    journal: r.journalTitle || "",
    date: r.pubYear || "",
    abstract: (r.abstractText || "").slice(0, 2000),
    url: r.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/` : (r.doi ? `https://doi.org/${r.doi}` : ""),
    keywords: [],
    doi: r.doi || "",
  }));
}

function loadSeenPmids() {
  const p = resolve(ROOT, "seen_pmids.json");
  if (existsSync(p)) {
    try { return new Set(JSON.parse(readFileSync(p, "utf-8"))); } catch { /* */ }
  }
  const docsDir = resolve(ROOT, "docs");
  if (!existsSync(docsDir)) return new Set();
  const pmids = new Set();
  for (const f of readdirSync(docsDir).filter((f) => f.startsWith("bulimia-") && f.endsWith(".html"))) {
    try {
      const html = readFileSync(resolve(docsDir, f), "utf-8");
      for (const m of html.matchAll(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/g)) pmids.add(m[1]);
    } catch { /* */ }
  }
  return pmids;
}

function saveSeenPmids(pmids) {
  writeFileSync(resolve(ROOT, "seen_pmids.json"), JSON.stringify([...pmids], null, 2), "utf-8");
}

function main() {
  const days = parseInt(process.env.FETCH_DAYS || "7", 10);
  const maxPapers = parseInt(process.env.MAX_PAPERS || "50", 10);

  console.error(`[INFO] Fetching BN papers from last ${days} days...`);

  let pmidList = [];
  try {
    pmidList = searchPubMed(buildJournalQuery(days), maxPapers);
    console.error(`[INFO] PubMed journal search: ${pmidList.length} results`);
  } catch (e) {
    console.error(`[WARN] PubMed journal search failed: ${e.message}`);
  }

  if (pmidList.length < 5) {
    try {
      const broad = searchPubMed(buildBroadQuery(days), maxPapers);
      console.error(`[INFO] PubMed broad search: ${broad.length} results`);
      const seen = new Set(pmidList);
      for (const id of broad) if (!seen.has(id)) pmidList.push(id);
    } catch (e) {
      console.error(`[WARN] PubMed broad search failed: ${e.message}`);
    }
  }

  let papers = [];
  if (pmidList.length > 0) {
    try {
      papers = fetchPubMedDetails(pmidList);
      console.error(`[INFO] Fetched details for ${papers.length} papers from PubMed`);
    } catch (e) {
      console.error(`[WARN] PubMed detail fetch failed: ${e.message}`);
    }
  }

  if (papers.length === 0) {
    console.error(`[INFO] Trying Europe PMC fallback...`);
    try {
      papers = searchEuropePMC("bulimia nervosa OR binge-purge OR binge eating purging", maxPapers);
      console.error(`[INFO] Europe PMC: ${papers.length} papers`);
    } catch (e) {
      console.error(`[WARN] Europe PMC also failed: ${e.message}`);
    }
  }

  const seenPmids = loadSeenPmids();
  papers = papers.filter((p) => !seenPmids.has(p.pmid));
  console.error(`[INFO] ${papers.length} new papers (after dedup from ${seenPmids.size} seen)`);

  const now = new Date();
  const taipei = new Date(now.getTime() + 8 * 3600000);
  const dateStr = `${taipei.getUTCFullYear()}-${String(taipei.getUTCMonth() + 1).padStart(2, "0")}-${String(taipei.getUTCDate()).padStart(2, "0")}`;

  writeFileSync(resolve(ROOT, "papers.json"), JSON.stringify({ date: dateStr, count: papers.length, papers }, null, 2), "utf-8");
  console.error(`[INFO] Saved to papers.json (${papers.length} papers)`);

  const newPmids = papers.filter((p) => p.pmid).map((p) => p.pmid);
  saveSeenPmids(new Set([...seenPmids, ...newPmids]));
}

try {
  main();
} catch (e) {
  console.error(`[FATAL] ${e.message}`);
  process.exit(1);
}
