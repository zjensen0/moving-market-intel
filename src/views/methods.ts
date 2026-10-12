// Data & methods: how the score works, where the data comes from, and what to read with care.
import type { Ctx } from "../app";
import { h } from "../lib/dom";

const SOURCES: [string, string, string, string][] = [
  ["Census Bureau, Population Estimates", "Population and net moves from the rest of the U.S.", "Vintage 2025 (to July 1, 2025)", "https://www.census.gov/programs-surveys/popest.html"],
  ["Census Bureau, American Community Survey", "People who moved in the past year, households, income, home values", "2024 1-year (2025 delayed)", "https://www.census.gov/programs-surveys/acs"],
  ["IRS Statistics of Income, migration data", "Households moving in and out, income of movers, metro-to-metro lanes", "2022 to 2023", "https://www.irs.gov/statistics/soi-tax-stats-migration-data"],
  ["Zillow Research", "Monthly home sales, new listings, home values, busiest months", "Through August 2026", "https://www.zillow.com/research/data/"],
  ["FMCSA carrier census and operating authority", "Household-goods movers, fleet sizes, new entrants", "October 11, 2026", "https://data.transportation.gov/d/az4n-8mr2"],
  ["FMCSA Safety Measurement System files", "Inspections, out-of-service rates and crashes for listed movers", "September 13, 2026 run", "https://data.transportation.gov/d/4y6x-dmck"],
  ["BLS Quarterly Census of Employment and Wages", "Pay and payroll locations for movers and competing employers", "2025 annual averages", "https://www.bls.gov/cew/"],
  ["Census Bureau, 2022 Economic Census", "Moving revenue by metro, local versus long-distance", "2022", "https://www.census.gov/data/tables/2022/econ/economic-census/naics-sector-48-49.html"],
  ["U.S. Energy Information Administration", "Weekly diesel prices by fuel region", "Week of October 5, 2026", "https://www.eia.gov/petroleum/gasdiesel/"],
  ["BLS Producer Price Index (PCU484210484210)", "What U.S. movers charge", "August 2026", "https://fred.stlouisfed.org/series/PCU484210484210"],
  ["Freddie Mac Primary Mortgage Market Survey", "30-year fixed mortgage rate", "October 8, 2026", "https://www.freddiemac.com/pmms"],
  ["BLS Current Employment Statistics", "U.S. moving industry jobs", "August 2026 (preliminary)", "https://www.bls.gov/ces/"],
  ["USAspending.gov", "Federal contracts coded as household and office moving", "Fiscal year 2025", "https://www.usaspending.gov/"],
  ["Census Bureau ZIP Code Tabulation Areas", "Placing your jobs' ZIP codes in metro areas (Your business page)", "2020 ZCTA to county, 2023 metro definitions", "https://www.census.gov/geographies/reference-files/time-series/geo/relationship-files.html"],
];

const p = (lead: string, text: string) => h("p", null, h("strong", null, lead), " " + text);

export function methodsView(el: HTMLElement, _ctx: Ctx) {
  el.replaceChildren(
    h("section", { class: "block", style: "margin-top:22px" },
      h("div", { class: "sec-head" }, h("h2", null, "How the score works")),
      h("div", { class: "panel w12" }, h("div", { class: "prose" },
        h("p", null, "Every metro gets a ranking from 0 to 100 on five parts, where 100 means it beats every other U.S. metro on that part. The opportunity score is the weighted average of the five. If a metro is missing data for a part, that part is skipped and the other weights are scaled up."),
        p("Market size", "is the estimated number of household moves a year: people who moved into a home in the metro in the past year (American Community Survey, 2024), divided by the average household size."),
        p("Momentum", "averages three rankings: net moves from the rest of the U.S. per 1,000 residents in 2025, the change in home sales over the latest three months versus a year earlier, and the same change for new listings."),
        p("Room to grow", "is household moves per licensed household-goods mover based in the metro. More moves per mover means less crowding."),
        p("Customer value", "averages two rankings: the average income of households moving in (IRS) and median household income (Census)."),
        p("Labor cost", "ranks the average weekly private-sector wage in reverse, so cheaper labor markets score higher.")))),
    h("section", { class: "block" },
      h("div", { class: "sec-head" }, h("h2", null, "How “Your business” compares your jobs to the market")),
      h("div", { class: "panel w12" }, h("div", { class: "prose" },
        p("Placing jobs on the map.", "Each job's origin and destination ZIP codes are matched to a metro using Census ZIP code areas. ZIP codes outside the 387 metros (rural areas) are kept but can't be placed in a metro."),
        p("Volume against the market.", "Your jobs per month and your metro's home sales per month are each scaled so their own average over the chart equals 100. That lets you compare the shape of the two lines, such as whether you held up when the market slowed, even though the counts are very different sizes. Lost jobs are left out."),
        p("Share of the market.", "Jobs that start or end in your home metro over the latest 12 months, divided by the metro's estimated household moves a year. Commercial, storage and labor-only jobs are counted too, so treat it as a rough gauge, not an exact market share."),
        p("Prices against the industry.", "Your average revenue per job (three-month rolling average) is compared with the BLS producer price index for moving services, both set to 100 at the start of the chart. A change in your job mix, such as more long-distance work, also moves your average, so read it alongside the job-type chart."),
        p("Untapped lanes.", "The largest long-distance lanes (100+ miles) to and from your home metro, from IRS household moves, set against the jobs you booked on each lane in the latest 12 months. A lane is flagged when at least 300 households a year make that move and your share of it is a small fraction of your typical lane share.")))),
    h("section", { class: "block" },
      h("div", { class: "sec-head" }, h("h2", null, "Data sources"), h("p", null, "All public. Checked October 11, 2026.")),
      h("div", { class: "panel w12" },
        h("div", { class: "tbl-wrap", style: "margin-top:0" },
          h("table", { class: "src" },
            h("thead", null, h("tr", null, h("th", null, "Source"), h("th", null, "Used for"), h("th", null, "Latest data"))),
            h("tbody", null, ...SOURCES.map(([n, u, d, url]) => h("tr", null,
              h("td", null, h("a", { href: url, target: "_blank", rel: "noopener" }, n)), h("td", null, u), h("td", null, d)))))))),
    h("section", { class: "block" },
      h("div", { class: "sec-head" }, h("h2", null, "Read these numbers with care")),
      h("div", { class: "panel w12" }, h("div", { class: "prose" },
        p("Movers", "counts carriers with active federal household-goods authority, plus carriers that declare household goods as cargo and are clearly movers by name or cargo profile. Each is counted once, at its headquarters ZIP code, with at least one truck and a federal filing updated in the last two years. Movers that only operate inside one state are included only where the state requires a USDOT number. Van line headquarters cities (such as Fenton near St. Louis, Fort Wayne, Evansville and Indianapolis) show very large fleets because owner-operators nationwide report through them."),
        p("Safety columns", "come from FMCSA's monthly SMS files (September 13, 2026 run). The vehicle out-of-service rate is the share of vehicle inspections where a truck was ordered off the road. Rates based on fewer than five inspections are shown in gray. These are not FMCSA safety ratings."),
        p("Lanes", "come from tax returns that changed address between 2022 and 2023. They miss people who don't file, and the IRS hides county pairs with fewer than 20 returns. The 2023 to 2024 data had not been released as of October 11, 2026."),
        p("Pay figures", "come from the BLS Quarterly Census of Employment and Wages. Starting with 2025, BLS stopped publishing industry detail for metro areas, so the metro figures here are rebuilt by adding up counties. If any county in the metro is suppressed, the metro figure is left blank and the statewide average for moving companies is shown instead."),
        p("Housing data", "is Zillow's, which still uses the 2020 metro boundaries. For a few metros whose boundaries changed in 2023, compare trends rather than levels. Four metros have no Zillow match."),
        p("Population and movers", "come from Vintage 2025 Census estimates and the 2024 American Community Survey. The 2025 survey release was delayed by the Census Bureau and was not available on October 11, 2026.")))),
    h("section", { class: "block" },
      h("div", { class: "sec-head" }, h("h2", null, "Who can see your data")),
      h("div", { class: "panel w12" }, h("div", { class: "prose" },
        h("p", null, "Jobs you upload are stored in your company's private space. The database itself checks every request, so only people who joined your company with an invite code, plus your account team for support, can read them. Other clients can't see your jobs, your company name or which markets you follow."),
        h("p", null, "You can download or delete all of your jobs at any time from the Your business page.")))));
}
