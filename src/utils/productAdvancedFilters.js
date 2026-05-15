import { isElectricalProduct } from './electricalProduct';
import { PRODUCT_TYPE_SLUGS, itemMatchesAnyProductTypeSlug, itemMatchesProductCategory } from './productTypes';

/** قواعد ألوان شائعة في أسماء المنتجات (عربي / إنجليزي) */
const COLOR_RULES = [
  { id: 'black', label: 'أسود', re: /(أسود|black|noir|negro)/i },
  { id: 'white', label: 'أبيض', re: /(أبيض|white|blanc|blanco)/i },
  { id: 'red', label: 'أحمر', re: /(أحمر|red|rouge|rojo)/i },
  { id: 'blue', label: 'أزرق', re: /(أزرق|blue|bleu|azul)/i },
  { id: 'green', label: 'أخضر', re: /(أخضر|green|vert|verde)/i },
  { id: 'silver', label: 'فضي', re: /(فضي|silver|argent|inox|stainless|ستينلس)/i },
  { id: 'gray', label: 'رمادي', re: /(رمادي|gray|grey|gris)/i },
  { id: 'gold', label: 'ذهبي', re: /(ذهبي|gold|doré|oro|rose\s*gold|روز)/i },
  { id: 'brown', label: 'بني', re: /(بني|brown|marron|café)/i },
  { id: 'beige', label: 'بيج', re: /(بيج|beige|كريمي|cream)/i },
  { id: 'pink', label: 'وردي', re: /(وردي|pink|rose)/i },
  { id: 'orange', label: 'برتقالي', re: /(برتقالي|orange)/i },
  { id: 'yellow', label: 'أصفر', re: /(أصفر|yellow|jaune)/i },
  { id: 'purple', label: 'بنفسجي', re: /(بنفسجي|purple|violet)/i },
];

export function extractColorIdsFromProductName(name) {
  const t = String(name || '');
  const out = [];
  for (const { id, re } of COLOR_RULES) {
    if (re.test(t)) out.push(id);
  }
  return out;
}

export function getAvailableColorOptions(items) {
  const seen = new Map();
  for (const item of items || []) {
    for (const id of extractColorIdsFromProductName(item.name)) {
      const rule = COLOR_RULES.find((r) => r.id === id);
      if (rule && !seen.has(id)) seen.set(id, rule.label);
    }
  }
  return COLOR_RULES.filter((r) => seen.has(r.id)).map((r) => ({ id: r.id, label: r.label }));
}

function itemMatchesElectricalCategory(item) {
  return isElectricalProduct({
    brandGroup: item.group,
    productName: item.name,
  });
}

/**
 * @param {'categories'|'brands'|'productTypes'|'colors'|null} omitFacet — تجاهل هذا البعد عند حساب العدادات (faceted counts)
 */
export function applyAdvancedProductFilters(items, f, omitFacet = null) {
  const categories = omitFacet === 'categories' ? [] : f.categories || [];
  const brands = omitFacet === 'brands' ? [] : f.brands || [];
  const productTypes = omitFacet === 'productTypes' ? [] : f.productTypes || [];
  const colors = omitFacet === 'colors' ? [] : f.colors || [];

  return (items || []).filter((item) => {
    if (categories.length > 0) {
      const el = itemMatchesElectricalCategory(item);
      const home = !el;
      const okCat =
        (categories.includes('electrical') && el) || (categories.includes('home') && home);
      if (!okCat) return false;
    }

    if (brands.length > 0) {
      const g = String(item.group || '').trim();
      if (!brands.includes(g)) return false;
    }

    if (productTypes.length > 0) {
      if (!itemMatchesAnyProductTypeSlug(productTypes, item)) return false;
    }

    if (colors.length > 0) {
      const found = extractColorIdsFromProductName(item.name);
      if (!found.some((id) => colors.includes(id))) return false;
    }

    return true;
  });
}

/**
 * عدد المنتجات لكل خيار فلتر مع تطبيق باقي الأبعاد (faceted).
 * @param {Array} items
 * @param {{ categories: string[], brands: string[], productTypes: string[], colors: string[] }} f
 */
export function computeFacetCounts(items, f) {
  const fState = {
    categories: f.categories || [],
    brands: f.brands || [],
    productTypes: f.productTypes || [],
    colors: f.colors || [],
  };

  const baseNoCat = applyAdvancedProductFilters(items, fState, 'categories');
  let electrical = 0;
  let home = 0;
  for (const i of baseNoCat) {
    if (itemMatchesElectricalCategory(i)) electrical += 1;
    else home += 1;
  }

  const baseNoBrand = applyAdvancedProductFilters(items, fState, 'brands');
  const brandCounts = {};
  for (const i of baseNoBrand) {
    const g = String(i.group || '').trim();
    if (!g) continue;
    brandCounts[g] = (brandCounts[g] || 0) + 1;
  }

  const baseNoProductType = applyAdvancedProductFilters(items, fState, 'productTypes');
  const productTypeCounts = {};
  for (const slug of PRODUCT_TYPE_SLUGS) {
    let n = 0;
    for (const i of baseNoProductType) {
      if (itemMatchesProductCategory(slug, i)) n += 1;
    }
    productTypeCounts[slug] = n;
  }

  const baseNoColor = applyAdvancedProductFilters(items, fState, 'colors');
  const colorCounts = {};
  for (const i of baseNoColor) {
    for (const id of extractColorIdsFromProductName(i.name)) {
      colorCounts[id] = (colorCounts[id] || 0) + 1;
    }
  }

  return {
    categories: { electrical, home },
    brandCounts,
    productTypeCounts,
    colorCounts,
  };
}
