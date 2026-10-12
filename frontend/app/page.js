"use client";

import { useEffect, useMemo, useState } from "react";

import { SessionButton, apiFetch } from "./auth";
// The record, the decoration it needs, and the palette are shared with the
// digest now — see the header of ./detail for why they stopped living here.
import {
  ACCENT, DetailPanel, FoldedGroup, NEGATIVE, RelatedItems, decorateItems,
  groupAnchors, relatedByGroup,
} from "./detail";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// Steps up to a lit square: the frontier, and the one thing past it.
function LogoMark({ size = 22 }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M2 21H8V15H14V10" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
      <rect x="14" y="2" width="8" height="8" fill={ACCENT} />
    </svg>
  );
}

function Dashboard() {
  const [audience, setAudience] = useState("investment");
  const [bandFilter, setBandFilter] = useState("all");
  // Two axes a reader actually arrives with: "what has <lab> been doing" and
  // "what has hit <holding>". Both are client-side — /api/items already ships
  // the whole corpus with its connections nested, so filtering here costs a
  // render and filtering server-side would cost a round trip per keystroke.
  const [labFilter, setLabFilter] = useState("all");
  const [docFilter, setDocFilter] = useState("all");
  const [holdingFilter, setHoldingFilter] = useState("all");
  const [sortBy, setSortBy] = useState("score");
  const [selectedId, setSelectedId] = useState(null);

  const [items, setItems] = useState([]);
  const [runStatus, setRunStatus] = useState(null);
  // Count of raised system alerts, for the header badge. Content alerts are the
  // product working; system alerts mean it is broken, and only those belong on
  // a badge that is meant to be noticed.
  const [systemAlerts, setSystemAlerts] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([
      apiFetch("/api/items"),
      apiFetch("/api/status"),
    ])
      .then(([itemsData, statusData]) => {
        setItems(itemsData);
        setRunStatus(statusData);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });

    // Separate and failure-tolerant: a badge that cannot load must not stop the
    // dashboard rendering the corpus.
    // Reads the windowed count from /api/health rather than pulling up to 200
    // full alert bodies to render one integer — and an all-time count could
    // never fall back to zero once anything had ever broken.
    apiFetch("/api/health")
      // Falls back to the pre-rename key: the API and this bundle deploy as
      // separate Render services, so for a few minutes on a sync one of them is
      // behind. Reading only the new key would paint the badge green against an
      // older API — a false green on the health indicator.
      .then((h) => setSystemAlerts(
        h?.unacknowledged_system_alerts ?? h?.recent_system_alerts ?? 0))
      .catch(() => setSystemAlerts(0));
  }, []);

  // Decoration, anchoring and link-resolution all moved to ./detail so the
  // digest renders the identical record. The rules are unchanged and their
  // reasoning travels with them; only the location differs.
  const decorated = useMemo(() => decorateItems(items, audience), [items, audience]);

  const [anchorFor, foldedByGroup] = useMemo(
    () => groupAnchors(decorated, audience), [decorated, audience]);

  const relatedForGroup = useMemo(
    () => relatedByGroup(decorated, anchorFor), [decorated, anchorFor]);

  // Options come from the corpus, not from config: an option that matches
  // nothing is a dead end, and the count next to each one says what is behind
  // it before the reader spends a click finding out.
  //
  // Counted over anchors only, matching what a click actually reveals. Counting
  // folded members too made "OpenAI 23" open 19 cards.
  const labOptions = useMemo(() => {
    const counts = new Map();
    for (const it of decorated) {
      if (anchorFor[it.groupId] !== it) continue;
      if (audience === "investment" ? it.score <= 0 : it.aiScore <= 0) continue;
      const seen = counts.get(it.lab) || { lab: it.lab, label: it.labLabel, n: 0 };
      seen.n += 1;
      counts.set(it.lab, seen);
    }
    return [...counts.values()].sort((a, b) => b.n - a.n);
  }, [decorated, anchorFor, audience]);

  const holdingOptions = useMemo(() => {
    const counts = new Map();
    for (const it of decorated) {
      if (anchorFor[it.groupId] !== it) continue;
      if (it.score <= 0) continue;
      // One count per article, not per connection: an article linked to a
      // holding by three routes is still one thing that happened to it.
      for (const holding of new Set(it.connections.map((c) => c.holding))) {
        counts.set(holding, (counts.get(holding) || 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([holding, n]) => ({ holding, n }))
      .sort((a, b) => b.n - a.n || a.holding.localeCompare(b.holding));
  }, [decorated, anchorFor]);

  // A holding filter has no meaning on the AI side — those items carry
  // practices, not connections — so it is dropped rather than left set and
  // silently emptying the list.
  const holdingActive = audience === "investment" && holdingFilter !== "all";

  // Lab options are recomputed per audience, so a lab with items on one side and
  // none on the other survives the switch as a value with no matching <option>.
  // The select then renders as "All labs", the filter chip resolves to undefined
  // and is dropped, and the reader sees "0 items" with nothing named as the
  // cause. Reset both filters on the switch rather than trying to render a
  // selection that no longer exists.
  function switchAudience(next) {
    if (next === audience) return;
    setAudience(next);
    setLabFilter("all");
    setHoldingFilter("all");
    setSelectedId(null);
  }

  const visible = useMemo(() => {
    const anchors = decorated.filter((it) => anchorFor[it.groupId] === it);
    const relevant = anchors.filter((it) => (audience === "investment" ? it.score > 0 : it.aiScore > 0));
    const byBand = bandFilter === "all"
      ? relevant
      // Investment filters on the band of the ranked value, so the filter and
      // the chip agree (D81).
      : relevant.filter((it) => (audience === "investment" ? it.displayBand : it.aiBand) === bandFilter);
    const byLab = labFilter === "all" ? byBand : byBand.filter((it) => it.lab === labFilter);
    // Papers and announcements are one corpus scored by one rule, so they rank
    // in one list by default. The filter is here because "what has the lab
    // published" and "what has the lab written up" are different questions.
    const byDoc = docFilter === "all" ? byLab : byLab.filter((it) => it.docType === docFilter);
    const byHolding = !holdingActive
      ? byDoc
      : byDoc.filter((it) => it.connections.some((c) => c.holding === holdingFilter));

    const sorted = [...byHolding].sort((a, b) => {
      if (sortBy === "date") return b.date.localeCompare(a.date);
      // Investment: the higher of event and holding score, then the other,
      // newest first on a full tie (app/ranking.py).
      if (audience === "investment") {
        return (b.rankValue - a.rankValue) || (b.rankMin - a.rankMin) || b.date.localeCompare(a.date);
      }
      return b.aiScore - a.aiScore;
    });

    // With a holding selected, the card's impact pills must lead with that
    // holding. Otherwise a list filtered to NVIDIA can show two pills naming
    // other companies, and the reader has to open every card to see why it is
    // in the list at all.
    if (!holdingActive) return sorted;
    return sorted.map((it) => {
      const mine = it.connections.filter((c) => c.holding === holdingFilter);
      const rest = it.connections.filter((c) => c.holding !== holdingFilter);
      return {
        ...it,
        impactPills: [...mine, ...rest].slice(0, 2).map((c) => ({
          label: `${c.holding} ${c.strength.toFixed(2)}`, color: c.color,
        })),
        showImpactRow: true,
      };
    });
  }, [decorated, anchorFor, audience, bandFilter, labFilter, docFilter, holdingFilter, holdingActive, sortBy]);

  const selected = decorated.find((it) => it.id === selectedId) || null;

  const bandOptions = ["all", "high", "medium", "low"];
  const sortOptions = ["score", "date"];

  const lastRunLabel = runStatus
    ? `Last run ${runStatus.status} · $${runStatus.cost_usd.toFixed(2)}`
    : "No runs recorded";

  return (
    <div className="app">
      <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
        <div style={{ height: 64, flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 24px", borderBottom: "1px solid var(--border)", background: "var(--bg-2)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, whiteSpace: "nowrap" }}>
              <LogoMark />
              <span className="serif" style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.01em" }}>Frontier Lab Intelligence</span>
            </div>
            <div className="toggle-track">
              <div className="toggle-thumb" style={{ transform: audience === "ai" ? "translateX(100%)" : "translateX(0%)" }} />
              <button className={audience === "ai" ? "toggle-seg" : "toggle-seg is-active"} onClick={() => switchAudience("investment")}>Investment</button>
              <button className={audience === "ai" ? "toggle-seg is-active" : "toggle-seg"} onClick={() => switchAudience("ai")}>AI team</button>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--muted)" }}>
              <span style={{ width: 6, height: 6, background: runStatus?.status === "failed" ? NEGATIVE : ACCENT, display: "inline-block" }} />
              {loading ? "Loading…" : lastRunLabel}
            </div>
            <a className="btn btn-ghost" href="/digest/" style={{ padding: "8px 14px", textDecoration: "none" }}>Alerts</a>
            <a className="btn btn-ghost" href="/pipeline/" style={{ padding: "8px 14px", textDecoration: "none" }}>Pipeline</a>
            {/* The health surface is a link rather than a tab: the dashboard
                answers "what did we learn", /ops answers "can I trust it". */}
            <a className="btn btn-ghost" href="/ops/" style={{ padding: "8px 14px", textDecoration: "none", display: "flex", alignItems: "center", gap: 8, borderColor: systemAlerts ? NEGATIVE : undefined, color: systemAlerts ? NEGATIVE : undefined }}>
              Health
              {systemAlerts ? <span style={{ fontSize: 11 }}>{systemAlerts}</span> : null}
            </a>
            <SessionButton />
          </div>
        </div>

        <div style={{ flex: "1 1 auto", display: "flex", overflow: "hidden" }}>
          <div className="sidebar" style={{ width: 220, flex: "0 0 220px", borderRight: "1px solid var(--border)", background: "var(--bg-2)", padding: "24px 20px", display: "flex", flexDirection: "column", gap: 28 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <span className="label-bracket">Band</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {bandOptions.map((v) => {
                  const active = bandFilter === v;
                  const label = v === "all" ? "All" : v.charAt(0).toUpperCase() + v.slice(1);
                  return (
                    <button
                      key={v}
                      className="btn"
                      style={{
                        textAlign: "left", padding: "8px 10px", fontWeight: 500,
                        background: active ? ACCENT : "transparent",
                        color: active ? "#fbfaf6" : "var(--muted)",
                        borderColor: active ? ACCENT : "var(--border)",
                      }}
                      onClick={() => setBandFilter(v)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <span className="label-bracket">Source</span>
              <select
                className="field-input"
                value={docFilter}
                onChange={(e) => setDocFilter(e.target.value)}
                style={{ padding: "8px 10px", fontSize: 13 }}
              >
                <option value="all">Everything</option>
                <option value="announcement">Announcements</option>
                <option value="paper">Papers</option>
                <option value="release">Releases</option>
                <option value="post">Posts</option>
              </select>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <span className="label-bracket">Lab</span>
              <select
                className="field-input"
                value={labFilter}
                onChange={(e) => setLabFilter(e.target.value)}
                style={{ padding: "8px 10px", fontSize: 13 }}
              >
                <option value="all">All labs</option>
                {labOptions.map((o) => (
                  <option key={o.lab} value={o.lab}>{o.label} ({o.n})</option>
                ))}
              </select>
            </div>

            {/* Investment side only: AI-team items carry practices, not
                holdings, so the control is removed rather than left to filter
                against a field that isn't there. */}
            {audience === "investment" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <span className="label-bracket">Holding</span>
                <select
                  className="field-input"
                  value={holdingFilter}
                  onChange={(e) => setHoldingFilter(e.target.value)}
                  style={{ padding: "8px 10px", fontSize: 13 }}
                >
                  <option value="all">All holdings</option>
                  {holdingOptions.map((o) => (
                    <option key={o.holding} value={o.holding}>{o.holding} ({o.n})</option>
                  ))}
                </select>
              </div>
            ) : null}

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <span className="label-bracket">Sort by</span>
              <div style={{ display: "flex", gap: 14 }}>
                {sortOptions.map((v) => {
                  const active = sortBy === v;
                  return (
                    <button
                      key={v}
                      className="btn"
                      style={{ background: "none", border: "none", padding: 0, color: active ? ACCENT : "var(--muted)", fontWeight: active ? 600 : 400 }}
                      onClick={() => setSortBy(v)}
                    >
                      {v.charAt(0).toUpperCase() + v.slice(1)}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="section-block" style={{ paddingTop: 20, display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="label-bracket">Showing</span>
              <div style={{ fontSize: 13, color: "var(--muted)" }}>{visible.length} items</div>
              {/* An empty list under a filter is an answer, not a failure —
                  but only if it says which filter produced it. */}
              {bandFilter !== "all" || labFilter !== "all" || docFilter !== "all" || holdingActive ? (
                <>
                  <div style={{ fontSize: 11, color: "var(--muted-2)", lineHeight: 1.6 }}>
                    {[
                      bandFilter !== "all" ? `${bandFilter} band` : null,
                      labFilter !== "all" ? labOptions.find((o) => o.lab === labFilter)?.label : null,
                      docFilter !== "all" ? `${docFilter}s` : null,
                      holdingActive ? holdingFilter : null,
                    ].filter(Boolean).join(" · ")}
                  </div>
                  <button
                    className="btn"
                    style={{ background: "none", border: "none", padding: 0, color: ACCENT, textAlign: "left", fontSize: 11 }}
                    onClick={() => { setBandFilter("all"); setLabFilter("all"); setDocFilter("all"); setHoldingFilter("all"); }}
                  >
                    Clear filters
                  </button>
                </>
              ) : null}
            </div>
          </div>

          <div className="scroll-y" style={{ flex: "1 1 auto", padding: "24px 32px", display: "flex", flexDirection: "column", gap: 12 }}>
            {error && (
              <div style={{ color: NEGATIVE, fontSize: 13 }}>
                Couldn&apos;t reach the API at {API} — is `uv run uvicorn api.main:app --port 8000` running?
              </div>
            )}
            {!error && !loading && visible.length === 0 && (
              <div style={{ color: "var(--muted)", fontSize: 13, padding: "40px 0" }}>No items match this filter.</div>
            )}
            {visible.map((item) => (
              <div key={item.id} className="card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }} onClick={() => setSelectedId(item.id)}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span className="label-bracket">{item.labLabel}</span>
                    {/* Papers and releases are badged; announcements are not.
                        Badging all three would put a pill on every card in the
                        feed to distinguish the majority case from itself. */}
                    {item.docType !== "announcement" && (
                      <span className="tag-pill" style={{ color: "var(--muted-2)" }}>{item.docType}</span>
                    )}
                    {/* Posts are one person speaking, not the lab, so the card
                        names the author and how firmly the handle is tied to
                        them. config/people.yaml grades that as own_site /
                        self_post / lab_post / search_index and calls the last
                        "a lead, not a fact"; a contested role is flagged
                        outright rather than rendered as settled. */}
                    {item.author?.authorHandle && (
                      <span className="tag-pill" style={{ color: "var(--muted-2)" }}>
                        @{item.author.authorHandle}
                        {item.author.evidence ? ` · ${item.author.evidence}` : ""}
                      </span>
                    )}
                    {item.author?.roleContested && (
                      <span className="tag-pill" style={{ color: "var(--accent)" }} title="config/people.yaml records this person's role as disputed between sources">
                        role contested
                      </span>
                    )}
                    <span style={{ fontSize: 12, color: "var(--muted-2)" }}>{item.date}</span>
                  </div>
                  {/* Investment names which score set the rank, with the other
                      one beside it; AI keeps its band. */}
                  <span style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    {item.displaySecondary && (
                      <span style={{ fontSize: 11, color: "var(--muted-2)" }}>{item.displaySecondary}</span>
                    )}
                    <span className="tag-pill" style={item.displayStyle}>{item.displayScore} · {item.displayLead || item.displayBand}</span>
                  </span>
                </div>
                <div className="serif" style={{ fontSize: 17, fontWeight: 500, lineHeight: 1.35 }}>{item.title}</div>
                <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>{item.summary}</div>
                {item.evidencePills.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {item.evidencePills.map((tag, i) => (
                      <span key={i} className="tag-pill" style={{ color: tag.color, borderColor: tag.color }}>{tag.arrow} {tag.label}</span>
                    ))}
                  </div>
                )}
                {item.showImpactRow && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {item.impactPills.map((p, i) => (
                      <span key={i} className="conn-pill" style={{ color: p.color, borderColor: p.color }}>→ {p.label}</span>
                    ))}
                  </div>
                )}
                {(relatedForGroup[item.groupId] || []).length > 0 && (
                  <RelatedItems items={relatedForGroup[item.groupId]} onOpen={setSelectedId} />
                )}
                {(foldedByGroup[item.groupId] || []).length > 0 && (
                  <FoldedGroup
                    members={foldedByGroup[item.groupId]}
                    reason={item.groupReason}
                    onOpen={setSelectedId}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* The full record, identical to the one the digest opens (./detail). */}
      <DetailPanel
        item={selected}
        related={selected ? relatedForGroup[selected.groupId] : null}
        audience={audience}
        onOpen={setSelectedId}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}


export default function Page() {
  return <Dashboard />;
}
