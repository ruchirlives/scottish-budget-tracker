export type BudgetSource = {
  year: string;
  documentsPage: string;
  level4LinkText: RegExp;
};

export const budgetSources: BudgetSource[] = [
  {
    year: '2022-23',
    documentsPage: 'https://www.gov.scot/publications/scottish-budget-2022-23/documents/',
    level4LinkText: /level 4 data/i,
  },
  {
    year: '2023-24',
    documentsPage: 'https://www.gov.scot/publications/scottish-budget-2023-24/documents/',
    level4LinkText: /level 4 data/i,
  },
  {
    year: '2024-25',
    documentsPage: 'https://www.gov.scot/publications/scottish-budget-2024-25/documents/',
    level4LinkText: /level 4 tables/i,
  },
  {
    year: '2025-26',
    documentsPage: 'https://www.gov.scot/publications/scottish-budget-2025-2026/documents/',
    level4LinkText: /level 4 budget tables/i,
  },
];
