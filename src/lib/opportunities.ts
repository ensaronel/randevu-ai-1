import { addDaysToKey, formatTL } from "@/lib/date";
import {
  computeCancellationStats,
  computeCustomerSegments,
  computeExpenses,
  computeOccupancy,
  computePackagesOverview,
  computeProfit,
  computeQuietBlocks,
  computeRevenue,
  computeRunRate,
  computeServiceStats,
  computeTeamStats,
  findPackageCandidates,
  formatHourRange,
  revenuePerBookedHour,
  round,
  type InsightDataset,
} from "@/lib/businessInsights";

export type OpportunityTone = "good" | "warn" | "info";
export type OpportunityIcon = "clock" | "users" | "ticket" | "alert" | "trend" | "scissors" | "team" | "wallet";

export interface Opportunity {
  id: string;
  icon: OpportunityIcon;
  tone: OpportunityTone;
  title: string;
  detail: string;
  /** Aylık tahmini parasal etki (TL) — varsayıma dayanır, impactNote'ta açıklanır. */
  impactTL: number | null;
  impactNote: string | null;
  /** "Danışmana sor" bağlantısına önceden yazılan soru. */
  ask: string;
}

export interface HealthComponent {
  key: "occupancy" | "growth" | "loyalty" | "cancellations" | "profitability";
  label: string;
  score: number;
  valueLabel: string;
}

export interface BusinessPulse {
  hasEnoughData: boolean;
  score: number | null;
  verdict: string;
  components: HealthComponent[];
  opportunities: Opportunity[];
}

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

function verdictFor(score: number): string {
  if (score >= 80) return "Çok iyi durumda";
  if (score >= 65) return "İyi gidiyor";
  if (score >= 45) return "Geliştirilebilir";
  return "Dikkat gerekiyor";
}

export function buildPulse(ds: InsightDataset): BusinessPulse {
  const today = ds.todayKey;
  const yesterday = addDaysToKey(today, -1);
  const last28From = addDaysToKey(today, -28);
  const prev28From = addDaysToKey(today, -56);
  const prev28To = addDaysToKey(today, -29);
  const last56From = addDaysToKey(today, -56);
  const last90From = addDaysToKey(today, -90);

  const recentBookings = ds.appointments.filter((a) => a.starts_at >= `${last56From}T00:00:00+03:00` && a.status !== "cancelled").length;
  if (recentBookings < 8) {
    return {
      hasEnoughData: false,
      score: null,
      verdict: "Nabız için biraz daha veri gerekiyor",
      components: [],
      opportunities: [],
    };
  }

  // ---------------------------------------------------------- sağlık skoru
  const components: HealthComponent[] = [];

  const occ = computeOccupancy(ds, last28From, yesterday);
  if (occ.percent !== null) {
    components.push({ key: "occupancy", label: "Doluluk", score: clamp((occ.percent / 70) * 100), valueLabel: `%${occ.percent}` });
  }

  const rev28 = computeRevenue(ds, last28From, yesterday).total;
  const revPrev = computeRevenue(ds, prev28From, prev28To).total;
  if (revPrev > 0) {
    const pct = ((rev28 - revPrev) / revPrev) * 100;
    components.push({
      key: "growth",
      label: "Büyüme",
      score: clamp(70 + pct * 1.5),
      valueLabel: `${pct >= 0 ? "+" : ""}%${Math.round(pct)}`,
    });
  }

  const seg = computeCustomerSegments(ds);
  if (seg.repeatRatePercent !== null && seg.customersWithVisits >= 5) {
    components.push({
      key: "loyalty",
      label: "Sadakat",
      score: clamp((seg.repeatRatePercent / 60) * 100),
      valueLabel: `%${seg.repeatRatePercent} tekrar`,
    });
  }

  const cancel28 = computeCancellationStats(ds, last28From, yesterday);
  if (cancel28.totalBookings >= 5 && cancel28.lossRatePercent !== null) {
    components.push({
      key: "cancellations",
      label: "İptal Kontrolü",
      score: clamp(100 - cancel28.lossRatePercent * 4),
      valueLabel: `%${Math.round(cancel28.lossRatePercent)} kayıp`,
    });
  }

  const profit28 = computeProfit(ds, last28From, yesterday);
  const hasExpenses = ds.fixedExpenses.length > 0 || ds.oneTimeExpenses.length > 0;
  if (hasExpenses && profit28.revenue.total > 0 && profit28.marginPercent !== null) {
    components.push({
      key: "profitability",
      label: "Kârlılık",
      score: clamp(40 + profit28.marginPercent * 1.5),
      valueLabel: `%${Math.round(profit28.marginPercent)} marj`,
    });
  }

  const score = components.length > 0 ? Math.round(components.reduce((s, c) => s + c.score, 0) / components.length) : null;

  // ---------------------------------------------------------- fırsat radarı
  const opps: Opportunity[] = [];

  // A) Boş kalan gün/saat blokları. Genel doluluk çok düşükse "şu saatler boş" demek anlamsız
  // (her saat boş) ve TL tahmini şişkin çıkar — bu durumda dürüstçe asıl sorunun talep olduğunu söyle.
  const rph = revenuePerBookedHour(ds, last56From, yesterday);
  const occ56 = computeOccupancy(ds, last56From, yesterday);
  if (occ56.percent !== null && occ56.percent < 15) {
    opps.push({
      id: "low-demand",
      icon: "alert",
      tone: "warn",
      title: `Kapasitenin sadece %${occ56.percent}'i kullanılıyor`,
      detail:
        `Son 8 haftada haftada ortalama ${round(occ56.capacityHours / 8, 0)} saatlik çalışma kapasitene karşılık ${round(occ56.bookedHours / 8, 0)} saat rezervasyon var. ` +
        `Bu düzeyde sorun belirli saatler değil, genel talep ve görünürlük. En hızlı kaldıraçlar: mevcut müşterilere tekrar/paket daveti, uzun süredir gelmeyenlere kişisel mesaj ve referans teşviki.`,
      impactTL: null,
      impactNote: null,
      ask: "Doluluğum çok düşük görünüyor. Talebi artırmak için ilk 30 günde verilerime göre neler yapmalıyım?",
    });
  } else if (rph !== null && rph > 0) {
    const blocks = computeQuietBlocks(ds, last56From, yesterday).filter((b) => b.freeHoursPerWeek >= 1.5);
    const seenDays = new Set<number>();
    for (const b of blocks) {
      if (seenDays.has(b.weekday)) continue;
      seenDays.add(b.weekday);
      const impact = Math.round(b.freeHoursPerWeek * 4.3 * 0.3 * rph);
      const range = formatHourRange(b.startHour, b.endHour);
      opps.push({
        id: `quiet-${b.weekday}-${b.startHour}`,
        icon: "clock",
        tone: "info",
        title: `${b.weekdayLabel} ${range} saatleri boş kalıyor`,
        detail:
          `Son 8 haftada bu saatlerin ortalama %${b.fillPercent}'i dolu; haftada yaklaşık ${b.freeHoursPerWeek} saatlik kapasite boşta. ` +
          `Bir rezerve saat ortalama ${formatTL(Math.round(rph))} kazandırıyor. Boşluğun %30'u dolsa ayda ≈ ${formatTL(impact)} eklenir.`,
        impactTL: impact,
        impactNote: "Varsayım: boş kapasitenin %30'u dolar, saat başı ortalama kazanç değişmez.",
        ask: `${b.weekdayLabel} günleri ${range} arası neden boş kalıyor olabilir ve bu saatleri doldurmak için somut bir kampanya planı çıkarır mısın?`,
      });
      if (seenDays.size >= 2) break;
    }
  }

  // B) Kaybedilen düzenli müşteriler
  const winbackCount = seg.lost + seg.atRisk;
  if (winbackCount >= 2 && seg.winbackAvgTicket) {
    const impact = Math.round(winbackCount * 0.3 * seg.winbackAvgTicket);
    const names = seg.winbackCandidates.slice(0, 3).map((c) => c.name).join(", ");
    opps.push({
      id: "winback",
      icon: "users",
      tone: "warn",
      title: `${winbackCount} düzenli müşteri uzun süredir uğramadı`,
      detail:
        `${seg.lost} kişi 90+ gündür, ${seg.atRisk} kişi 45-90 gündür gelmiyor; ortalama ziyaret değeri ${formatTL(seg.winbackAvgTicket)}. ` +
        `En değerlileri: ${names}. %30'u geri dönerse ≈ ${formatTL(impact)}.`,
      impactTL: impact,
      impactNote: "Varsayım: uzun süredir gelmeyenlerin %30'u tek bir ziyaretle geri döner.",
      ask: "Uzun süredir gelmeyen düzenli müşterilerimi geri kazanmak için kişiye özel bir plan ve mesaj taslağı hazırlar mısın?",
    });
  }

  // C) Paket satış fırsatı
  const pkgCandidates = findPackageCandidates(ds);
  if (pkgCandidates.length >= 2) {
    const potential = pkgCandidates.reduce((s, c) => s + c.spendLast90Days, 0);
    const impact = Math.round(potential * 0.3);
    const sample = pkgCandidates
      .slice(0, 3)
      .map((c) => `${c.customerName} (${c.serviceName}, ${c.visitsLast90Days} kez)`)
      .join(", ");
    opps.push({
      id: "package-candidates",
      icon: "ticket",
      tone: "info",
      title: `${pkgCandidates.length} müşteri aynı hizmeti düzenli alıyor ama paketi yok`,
      detail:
        `Son 90 günde aynı hizmeti 3+ kez almışlar: ${sample}. Bu müşterilerin 90 günlük harcaması ${formatTL(Math.round(potential))}; ` +
        `%30'u paket alırsa ≈ ${formatTL(impact)} ön tahsilat ve daha yüksek bağlılık.`,
      impactTL: impact,
      impactNote: "Varsayım: adayların %30'u paket satın alır (ön tahsilat, ek ciro değil).",
      ask: "Düzenli müşterilerime paket satmak için nasıl bir paket kurgusu, fiyatlama ve teklif mesajı önerirsin?",
    });
  }

  // D) İptal / gelmeme
  const cancel90 = computeCancellationStats(ds, last90From, yesterday);
  if (cancel90.lossRatePercent !== null && cancel90.totalBookings >= 12) {
    const worstDay = cancel90.byWeekday.find((r) => r.total >= 6);
    const overallHigh = cancel90.lossRatePercent >= 12;
    const dayHigh = worstDay && worstDay.ratePercent >= 18 && worstDay.ratePercent >= cancel90.lossRatePercent * 1.5;
    if (overallHigh || dayHigh) {
      const monthlyLost = cancel90.lostRevenue / 3;
      const impact = Math.round(monthlyLost * 0.3);
      opps.push({
        id: "cancellations",
        icon: "alert",
        tone: "warn",
        title: dayHigh && worstDay ? `${worstDay.label} randevularının %${worstDay.ratePercent}'i boşa gidiyor` : `Randevuların %${Math.round(cancel90.lossRatePercent)}'i iptal/gelmedi`,
        detail:
          `Son 90 günde ${cancel90.cancelled} iptal ve ${cancel90.noShows} gelmeme oldu; kaybedilen tutar ≈ ${formatTL(cancel90.lostRevenue)} (ayda ≈ ${formatTL(Math.round(monthlyLost))}). ` +
          `Hatırlatma ve son dakika onayı ile bunun %30'u kurtarılırsa ayda ≈ ${formatTL(impact)}.`,
        impactTL: impact,
        impactNote: "Varsayım: kayıpların %30'u hatırlatma/onay akışıyla kurtarılır.",
        ask: "İptal ve gelmeme oranımı düşürmek için verilerime bakarak ne yapmalıyım? Hangi gün/hizmet/personelde sorun var?",
      });
    }
  }

  // E) Hizmet fiyat/verimlilik farkı
  const services90 = computeServiceStats(ds, last90From, yesterday).filter((s) => s.bookings >= 6 && s.revenuePerHour !== null);
  if (services90.length >= 2) {
    const sorted = [...services90].sort((a, b) => (b.revenuePerHour ?? 0) - (a.revenuePerHour ?? 0));
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    if ((worst.revenuePerHour ?? 0) < (best.revenuePerHour ?? 0) * 0.65) {
      const impact = Math.round((worst.revenue / 3) * 0.1);
      opps.push({
        id: "service-yield",
        icon: "scissors",
        tone: "info",
        title: `${worst.name} saatte ${formatTL(worst.revenuePerHour ?? 0)}, ${best.name} ${formatTL(best.revenuePerHour ?? 0)} kazandırıyor`,
        detail:
          `${worst.name} son 90 günde ${worst.bookings} kez rezerve edildi ama saat başına getirisi en yüksek hizmetin %${Math.round(((worst.revenuePerHour ?? 0) / (best.revenuePerHour ?? 1)) * 100)}'i. ` +
          `Fiyatı %10 artırıp talep değişmezse ayda ≈ ${formatTL(impact)}; ya da bu hizmeti başka bir hizmetle paketleyebilirsin.`,
        impactTL: impact,
        impactNote: "Varsayım: fiyat %10 artar ve talep düşmez (talep düşerse etki azalır).",
        ask: `${worst.name} hizmetinin saat başı getirisi düşük görünüyor; fiyatlama, paketleme veya süre optimizasyonu için ne önerirsin?`,
      });
    }
  }

  // F) Personel dengesizliği
  const team = computeTeamStats(ds, last28From, yesterday).filter((t) => t.occupancyPercent !== null);
  if (team.length >= 2) {
    const sortedTeam = [...team].sort((a, b) => (b.occupancyPercent ?? 0) - (a.occupancyPercent ?? 0));
    const hi = sortedTeam[0];
    const lo = sortedTeam[sortedTeam.length - 1];
    if ((hi.occupancyPercent ?? 0) >= 75 && (lo.occupancyPercent ?? 0) <= 40 && (hi.occupancyPercent ?? 0) - (lo.occupancyPercent ?? 0) >= 35) {
      const missing = hi.servicesOffered.filter((s) => !lo.servicesOffered.includes(s));
      opps.push({
        id: "team-balance",
        icon: "team",
        tone: "info",
        title: `${hi.name} %${hi.occupancyPercent} dolu, ${lo.name} %${lo.occupancyPercent}`,
        detail:
          `Son 4 haftada ekip dengesiz çalışıyor. ${hi.name}'e yığılan işleri ${lo.name}'e kaydırmak müşteri bekleme süresini azaltıp toplam cirodan daha fazla pay almanı sağlar.` +
          (missing.length > 0 ? ` ${lo.name}'in "Verdiği Hizmetler" listesinde şunlar yok: ${missing.slice(0, 3).join(", ")} — eklersen AI randevuları ona da yönlendirir.` : ""),
        impactTL: null,
        impactNote: null,
        ask: `${hi.name} çok yoğun, ${lo.name} boşta görünüyor; ekip yükünü dengelemek için ne yapmalıyım?`,
      });
    }
  }

  // G) Ay tempo tahmini
  const rr = computeRunRate(ds);
  if (rr.projection !== null && rr.lastMonthRevenue > 0 && rr.elapsedOpenDays >= 5 && rr.avgPerOpenDay) {
    const ratio = rr.projection / rr.lastMonthRevenue;
    if (ratio < 0.9) {
      const gap = rr.lastMonthRevenue - rr.projection;
      const needed = rr.remainingOpenDays > 0 ? Math.round((rr.lastMonthRevenue - rr.mtdRevenue) / rr.remainingOpenDays) : 0;
      opps.push({
        id: "run-rate-low",
        icon: "trend",
        tone: "warn",
        title: `Bu tempoyla ay sonu ≈ ${formatTL(rr.projection)} (geçen ayın %${Math.round((1 - ratio) * 100)} altında)`,
        detail:
          `Ay başından ${formatTL(rr.mtdRevenue)} ciro yaptın, günlük ortalama ${formatTL(rr.avgPerOpenDay)}. ` +
          `Geçen ayın ${formatTL(rr.lastMonthRevenue)} seviyesini yakalamak için kalan ${rr.remainingOpenDays} çalışma gününde günde ≈ ${formatTL(needed)} gerekiyor.`,
        impactTL: Math.round(gap),
        impactNote: "Geçen ayla aradaki tahmini fark.",
        ask: `Bu ay geçen ayın gerisinde kalıyorum; kalan günlerde açığı kapatmak için hangi hamleleri yapmalıyım?`,
      });
    } else if (ratio >= 1.1) {
      opps.push({
        id: "run-rate-high",
        icon: "trend",
        tone: "good",
        title: `Bu tempoyla ay sonu ≈ ${formatTL(rr.projection)} (geçen aydan %${Math.round((ratio - 1) * 100)} fazla)`,
        detail: `Ay başından ${formatTL(rr.mtdRevenue)} ciro, günlük ortalama ${formatTL(rr.avgPerOpenDay)}. Şimdiden önümüzdeki günlerde ${formatTL(rr.bookedAhead)} tutarında randevu da alınmış durumda.`,
        impactTL: null,
        impactNote: null,
        ask: "Bu ay iyi gidiyorum; bu ivmeyi korumak ve bir sonraki aya taşımak için ne yapmalıyım?",
      });
    }
  }

  // H) Kullanılmayan paket seansları
  const pkgs = computePackagesOverview(ds);
  if (pkgs.idlePackages.length >= 1) {
    const sessions = pkgs.idlePackages.reduce((s, p) => s + p.remainingSessions, 0);
    const value = pkgs.idlePackages.reduce((s, p) => s + p.remainingSessions * p.perSessionValue, 0);
    const names = pkgs.idlePackages.slice(0, 3).map((p) => p.customerName).join(", ");
    opps.push({
      id: "idle-packages",
      icon: "ticket",
      tone: "warn",
      title: `${pkgs.idlePackages.length} müşterinin paket seansı kullanılmayı bekliyor`,
      detail:
        `${sessions} seans (≈ ${formatTL(Math.round(value))} değerinde) 30+ gündür kullanılmadı: ${names}. ` +
        `Tahsilatı yapılmış bu seansları randevuya çevirmek doluluğu artırır ve süre dolumu/iade itirazı riskini azaltır.`,
      impactTL: null,
      impactNote: null,
      ask: "Kullanılmayan paket seansı olan müşterilere hatırlatma mesajı hazırlar mısın? Kimlere yazmalıyım?",
    });
  }

  // I) Gider verisi yok
  if (ds.fixedExpenses.length === 0) {
    opps.push({
      id: "no-expenses",
      icon: "wallet",
      tone: "info",
      title: "Giderlerini girmediğin için net kârı hesaplayamıyorum",
      detail: "Kasa > Sabit Gider bölümüne kira, fatura, malzeme gibi aylık giderlerini girersen Net Kâr, kârlılık skoru ve marj tavsiyeleri devreye girer.",
      impactTL: null,
      impactNote: null,
      ask: "Kasa'ya hangi giderleri girmeliyim ve net kârımı doğru görmek için nelere dikkat etmeliyim?",
    });
  } else {
    // K) Gider oranı yüksek
    const exp28 = computeExpenses(ds, last28From, yesterday);
    if (rev28 > 0 && exp28.total > rev28 * 0.6) {
      opps.push({
        id: "expense-ratio",
        icon: "wallet",
        tone: "warn",
        title: `Giderler cironun %${Math.round((exp28.total / rev28) * 100)}'ini yiyor`,
        detail: `Son 28 günde ${formatTL(Math.round(rev28))} ciroya karşılık ${formatTL(Math.round(exp28.total))} gider var. En büyük kalem: ${exp28.byCategory[0]?.category ?? "belirsiz"}.`,
        impactTL: null,
        impactNote: null,
        ask: "Giderlerim cironun büyük kısmını yiyor; nerelerde tasarruf edebilir veya geliri artırabilirim?",
      });
    }
  }

  // J) Bekleme listesi
  if (ds.waitlistOpen.length >= 2) {
    const counts = new Map<string, number>();
    for (const w of ds.waitlistOpen) {
      if (w.desired_service_id) counts.set(w.desired_service_id, (counts.get(w.desired_service_id) ?? 0) + 1);
    }
    const topId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const topName = ds.services.find((s) => s.id === topId)?.name;
    opps.push({
      id: "waitlist",
      icon: "users",
      tone: "info",
      title: `${ds.waitlistOpen.length} kişi bekleme listesinde`,
      detail: `Talep var ama uygun saat bulunamıyor${topName ? ` (en çok istenen: ${topName})` : ""}. İptal olan saatler otomatik bu kişilere teklif ediliyor; sürekli bekleyen varsa o saatlere kapasite eklemek (uzatılmış mesai, ek personel) kazanç getirebilir.`,
      impactTL: null,
      impactNote: null,
      ask: "Bekleme listemde talep birikiyor; kapasiteyi nasıl artırabilirim ve bu talebi nasıl karşılarım?",
    });
  }

  const ranked = opps.sort((a, b) => {
    const ai = a.impactTL ?? -1;
    const bi = b.impactTL ?? -1;
    if (bi !== ai) return bi - ai;
    const toneRank = { warn: 0, good: 1, info: 2 } as const;
    return toneRank[a.tone] - toneRank[b.tone];
  });

  return {
    hasEnoughData: true,
    score,
    verdict: score !== null ? verdictFor(score) : "Henüz skor hesaplanamadı",
    components,
    opportunities: ranked.slice(0, 6),
  };
}
