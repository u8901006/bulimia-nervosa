import { writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const PUBMED_SEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const PUBMED_FETCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";

const JOURNALS = [
  "International Journal of Eating Disorders",
  "European Eating Disorders Review",
  "Journal of Eating Disorders",
  "Eating Disorders: The Journal of Treatment & Prevention",
  "Eating and Weight Disorders - Studies on Anorexia, Bulimia and Obesity",
  "Body Image",
  "Appetite",
  "Nutrients",
  "Journal of the Academy of Nutrition and Dietetics",
  "American Journal of Clinical Nutrition",
  "Clinical Nutrition",
  "Nutrition Reviews",
  "Psychological Medicine",
  "JAMA Psychiatry",
  "The Lancet Psychiatry",
  "American Journal of Psychiatry",
  "Journal of Clinical Psychiatry",
  "Comprehensive Psychiatry",
  "Behaviour Research and Therapy",
  "Journal of Consulting and Clinical Psychology",
  "Clinical Psychology Review",
  "Clinical Psychological Science",
  "Psychotherapy and Psychosomatics",
  "Assessment",
  "Psychological Assessment",
  "Child and Adolescent Psychiatry and Mental Health",
  "Journal of Child Psychology and Psychiatry",
  "Journal of Adolescent Health",
  "Pediatrics",
  "Biological Psychiatry",
  "Molecular Psychiatry",
  "Translational Psychiatry",
  "Neuropsychopharmacology",
  "Neuroscience & Biobehavioral Reviews",
  "NeuroImage: Clinical",
  "Human Brain Mapping",
  "Frontiers in Behavioral Neuroscience",
  "Hormones and Behavior",
  "Psychoneuroendocrinology",
  "Addiction",
  "Drug and Alcohol Dependence",
  "Social Science & Medicine",
  "Sociology of Health & Illness",
  "Qualitative Health Research",
  "Culture, Medicine, and Psychiatry",
  "British Journal of Sports Medicine",
  "Sports Medicine",
  "Medicine & Science in Sports & Exercise",
  "Psychology of Sport and Exercise",
];

const CORE_QUERY = '("Bulimia Nervosa"[Mesh] OR "bulimia nervosa"[tiab] OR bulimia[tiab] OR "binge-purge"[tiab] OR "binge eating and purging"[tiab])';

function buildQuery(days) {
  const since = new Date(Date.now() - days * 86400000);
  const yyyy = since.getUTCFullYear();
  const mm = String(since.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(since.getUTCDate()).padStart(2, "0");
  const dateFilter = `"${yyyy}/${mm}/${dd}"[Date - Publication] : "3000"[Date - Publication]`;
  const coreJournals = JOURNALS.slice(0, 15);
  const journalPart = coreJournals.map((j) => `"${j}"[Journal]`).join(" OR ");
  return `(${CORE_QUERY}) AND (${journalPart}) AND ${dateFilter}`;
}

function buildQueryBatch2(days) {
  const since = new Date(Date.now() - days * 86400000);
  const yyyy = since.getUTCFullYear();
  const mm = String(since.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(since.getUTCDate()).padStart(2, "0");
  const dateFilter = `"${yyyy}/${mm}/${dd}"[Date - Publication] : "3000"[Date - Publication]`;
  const restJournals = JOURNALS.slice(15);
  const journalPart = restJournals.map((j) => `"${j}"[Journal]`).join(" OR ");
  return `(${CORE_QUERY}) AND (${journalPart}) AND ${dateFilter}`;
}

function buildBroadQuery(days) {
  const since = new Date(Date.now() - days * 86400000);
  const yyyy = since.getUTCFullYear();
  const mm = String(since.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(since.getUTCDate()).padStart(2, "0");
  const dateFilter = `"${yyyy}/${mm}/${dd}"[Date - Publication] : "3000"[Date - Publication]`;
  return `(${CORE_QUERY}) AND ${dateFilter}`;
}

function curlGet(url, timeoutMs = 30000) {
  const timeoutSec = Math.ceil(timeoutMs / 1000);
  const result = execSync(
    `curl -sS -L --max-time ${timeoutSec} -H "User-Agent: BulimiaNervosaBot/1.0 (research aggregator)" -- "${url}"`,
    { encoding: "utf-8", timeout: timeoutMs + 5000, maxBuffer: 10 * 1024 * 1024 }
  );
  return result;
}

function encodeQuery(str) {
  return encodeURIComponent(str).replace(/%20/g, "+");
}

function searchPapers(query, retmax = 60) {
  const url = `${PUBMED_SEARCH}?db=pubmed&term=${encodeQuery(query)}&retmax=${retmax}&sort=date&retmode=json`;
  try {
    const text = curlGet(url, 30000);
    if (text.trim().startsWith("<!DOCTYPE") || text.trim().startsWith("<html") || text.trim().startsWith("<HTML")) {
      throw new Error("PubMed returned HTML error page");
    }
    const data = JSON.parse(text);
    return data?.esearchresult?.idlist || [];
  } catch (e) {
    throw e;
  }
}
    const data = JSON.parse(text);
    return data?.esearchresult?.idlist || [];
  } catch (e) {
    throw e;
  }
}

function fetchDetails(pmids) {
  if (!pmids.length) return [];
  const url = `${PUBMED_FETCH}?db=pubmed&id=${pmids.join(",")}&retmode=xml`;
  const xml = curlGet(url, 60000);
  if (xml.trim().startsWith("<!DOCTYPE html") || xml.includes("<title>Error</title>")) {
    throw new Error("PubMed fetch returned HTML error");
  }
  return parsePapersXML(xml);
}
  return parsePapersXML(xml);
}

function parsePapersXML(xml) {
  const papers = [];
  const articleRegex = /<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/g;
  let match;
  while ((match = articleRegex.exec(xml)) !== null) {
    const block = match[1];
    const titleMatch = block.match(/<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "";
    const pmidMatch = block.match(/<PMID[^>]*>(\d+)<\/PMID>/);
    const pmid = pmidMatch ? pmidMatch[1] : "";
    const journalMatch = block.match(/<Title>([\s\S]*?)<\/Title>/);
    const journal = journalMatch ? journalMatch[1].trim() : "";

    const abstractParts = [];
    const absRegex = /<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g;
    let absMatch;
    while ((absMatch = absRegex.exec(block)) !== null) {
      const labelMatch = absMatch[0].match(/Label="([^"]*)"/);
      const label = labelMatch ? labelMatch[1] : "";
      const text = absMatch[1].replace(/<[^>]+>/g, "").trim();
      if (text) {
        abstractParts.push(label ? `${label}: ${text}` : text);
      }
    }
    const abstract = abstractParts.join(" ").slice(0, 2000);

    const yearMatch = block.match(/<Year>(\d{4})<\/Year>/);
    const monthMatch = block.match(/<Month>([^<]+)<\/Month>/);
    const dayMatch = block.match(/<Day>(\d+)<\/Day>/);
    const dateParts = [
      yearMatch?.[1] || "",
      monthMatch?.[1] || "",
      dayMatch?.[1] || "",
    ].filter(Boolean);
    const dateStr = dateParts.join(" ");

    const keywords = [];
    const kwRegex = /<Keyword>([\s\S]*?)<\/Keyword>/g;
    let kwMatch;
    while ((kwMatch = kwRegex.exec(block)) !== null) {
      const kw = kwMatch[1].trim();
      if (kw) keywords.push(kw);
    }

    papers.push({
      pmid,
      title,
      journal,
      date: dateStr,
      abstract,
      url: pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : "",
      keywords,
    });
  }
  return papers;
}

function loadSeenPmids() {
  const seenPath = resolve(ROOT, "seen_pmids.json");
  if (existsSync(seenPath)) {
    try {
      return new Set(JSON.parse(readFileSync(seenPath, "utf-8")));
    } catch {
      return new Set();
    }
  }
  const docsDir = resolve(ROOT, "docs");
  if (!existsSync(docsDir)) return new Set();
  const files = readdirSync(docsDir).filter((f) => f.startsWith("bulimia-") && f.endsWith(".html"));
  const pmids = new Set();
  for (const f of files) {
    try {
      const html = readFileSync(resolve(docsDir, f), "utf-8");
      const urlMatches = html.matchAll(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/g);
      for (const m of urlMatches) {
        pmids.add(m[1]);
      }
    } catch {}
  }
  return pmids;
}

function saveSeenPmids(pmids) {
  const seenPath = resolve(ROOT, "seen_pmids.json");
  writeFileSync(seenPath, JSON.stringify([...pmids], null, 2), "utf-8");
}

function main() {
  const days = parseInt(process.env.FETCH_DAYS || "7", 10);
  const maxPapers = parseInt(process.env.MAX_PAPERS || "50", 10);

  console.error(`[INFO] Fetching BN papers from last ${days} days...`);

  let pmids;
  try {
    pmids = searchPapers(buildQuery(days), maxPapers);
    console.error(`[INFO] Journal batch 1: ${pmids.length} results`);
  } catch (e) {
    console.error(`[WARN] Journal batch 1 failed: ${e.message}`);
    pmids = [];
  }

  try {
    const batch2 = searchPapers(buildQueryBatch2(days), maxPapers);
    console.error(`[INFO] Journal batch 2: ${batch2.length} results`);
    const existing = new Set(pmids);
    for (const id of batch2) {
      if (!existing.has(id)) pmids.push(id);
    }
  } catch (e) {
    console.error(`[WARN] Journal batch 2 failed: ${e.message}`);
  }

  if (pmids.length < 5) {
    try {
      const broad = searchPapers(buildBroadQuery(days), maxPapers);
      console.error(`[INFO] Broad search: ${broad.length} results`);
      const existing = new Set(pmids);
      for (const id of broad) {
        if (!existing.has(id)) pmids.push(id);
      }
    } catch (e) {
      console.error(`[WARN] Broad search also failed: ${e.message}`);
    }
  }

  const seenPmids = loadSeenPmids();
  const newPmids = pmids.filter((id) => !seenPmids.has(id));
  console.error(`[INFO] ${newPmids.length} new papers (after dedup from ${seenPmids.size} seen)`);

  let papers = [];
  if (newPmids.length > 0) {
    papers = fetchDetails(newPmids);
    console.error(`[INFO] Fetched details for ${papers.length} papers`);
  }

  const now = new Date();
  const taipei = new Date(now.getTime() + 8 * 3600000);
  const dateStr = `${taipei.getUTCFullYear()}-${String(taipei.getUTCMonth() + 1).padStart(2, "0")}-${String(taipei.getUTCDate()).padStart(2, "0")}`;

  const output = { date: dateStr, count: papers.length, papers };

  const outPath = resolve(ROOT, "papers.json");
  writeFileSync(outPath, JSON.stringify(output, null, 2), "utf-8");
  console.error(`[INFO] Saved to papers.json (${papers.length} papers)`);

  const allSeen = new Set([...seenPmids, ...newPmids]);
  saveSeenPmids(allSeen);
}

main().catch((e) => {
  console.error(`[FATAL] ${e.message}`);
  process.exit(1);
});
