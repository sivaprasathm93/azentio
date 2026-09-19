/**
 * Selectable jurisdictions for the high-risk watchlist. `fatf` marks an indicative FATF public-statement status;
 * the backend watchlist (`/api/v1/watchlist`) is the source of truth for what is actually active, and the UI
 * shows the backend's list name whenever it has one.
 */
export type FatfStatus = 'BLACKLIST' | 'GREYLIST' | null

export interface Country {
  code: string
  name: string
  fatf: FatfStatus
}

export const COUNTRIES: Country[] = [
  { code: 'KP', name: 'North Korea (DPRK)', fatf: 'BLACKLIST' },
  { code: 'IR', name: 'Iran', fatf: 'BLACKLIST' },
  { code: 'MM', name: 'Myanmar', fatf: 'BLACKLIST' },
  { code: 'DZ', name: 'Algeria', fatf: 'GREYLIST' },
  { code: 'AO', name: 'Angola', fatf: 'GREYLIST' },
  { code: 'BO', name: 'Bolivia', fatf: 'GREYLIST' },
  { code: 'BG', name: 'Bulgaria', fatf: 'GREYLIST' },
  { code: 'CM', name: 'Cameroon', fatf: 'GREYLIST' },
  { code: 'CI', name: "Côte d'Ivoire", fatf: 'GREYLIST' },
  { code: 'CD', name: 'DR Congo', fatf: 'GREYLIST' },
  { code: 'HT', name: 'Haiti', fatf: 'GREYLIST' },
  { code: 'KE', name: 'Kenya', fatf: 'GREYLIST' },
  { code: 'LA', name: 'Laos', fatf: 'GREYLIST' },
  { code: 'LB', name: 'Lebanon', fatf: 'GREYLIST' },
  { code: 'MC', name: 'Monaco', fatf: 'GREYLIST' },
  { code: 'NA', name: 'Namibia', fatf: 'GREYLIST' },
  { code: 'NP', name: 'Nepal', fatf: 'GREYLIST' },
  { code: 'SS', name: 'South Sudan', fatf: 'GREYLIST' },
  { code: 'SY', name: 'Syria', fatf: 'GREYLIST' },
  { code: 'VE', name: 'Venezuela', fatf: 'GREYLIST' },
  { code: 'VN', name: 'Vietnam', fatf: 'GREYLIST' },
  { code: 'VG', name: 'British Virgin Islands', fatf: 'GREYLIST' },
  { code: 'YE', name: 'Yemen', fatf: 'GREYLIST' },
  { code: 'AF', name: 'Afghanistan', fatf: null },
  { code: 'BY', name: 'Belarus', fatf: null },
  { code: 'CU', name: 'Cuba', fatf: null },
  { code: 'CY', name: 'Cyprus', fatf: null },
  { code: 'LY', name: 'Libya', fatf: null },
  { code: 'PA', name: 'Panama', fatf: null },
  { code: 'PK', name: 'Pakistan', fatf: null },
  { code: 'RU', name: 'Russia', fatf: null },
  { code: 'SO', name: 'Somalia', fatf: null },
  { code: 'SD', name: 'Sudan', fatf: null },
  { code: 'TR', name: 'Türkiye', fatf: null },
  { code: 'AE', name: 'United Arab Emirates', fatf: null },
  { code: 'ZW', name: 'Zimbabwe', fatf: null },
]

export const COUNTRY_BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]))

export function countryName(code: string) {
  return COUNTRY_BY_CODE.get(code.toUpperCase())?.name ?? code.toUpperCase()
}
