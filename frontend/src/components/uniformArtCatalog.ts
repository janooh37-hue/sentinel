export const UNIFORM_ART_KINDS = ['suit', 'boots', 'polo', 'cargo', 'belt', 'cap', 'socks', 'jacket', 'vest', 'parka', 'dressshirt', 'longsleeve'] as const

export type UniformArtKind = typeof UNIFORM_ART_KINDS[number]

export const UNIFORM_ART_GROUPS = [
  {
    "id": "tops",
    "en": "Shirts",
    "ar": "قمصان"
  },
  {
    "id": "outerwear",
    "en": "Jackets and coats",
    "ar": "سترات ومعاطف"
  },
  {
    "id": "bottoms",
    "en": "Trousers",
    "ar": "بناطيل"
  },
  {
    "id": "headwear",
    "en": "Headwear",
    "ar": "أغطية الرأس"
  },
  {
    "id": "footwear",
    "en": "Footwear",
    "ar": "أحذية"
  },
  {
    "id": "accessories",
    "en": "Accessories",
    "ar": "ملحقات الملابس"
  }
] as const

export type UniformArtGroup = typeof UNIFORM_ART_GROUPS[number]['id']

export const UNIFORM_ART_LABELS = [
  {
    "kind": "suit",
    "en": "Suit",
    "ar": "بدلة",
    "group": "outerwear"
  },
  {
    "kind": "boots",
    "en": "Boots",
    "ar": "حذاء ميداني",
    "group": "footwear"
  },
  {
    "kind": "polo",
    "en": "Polo shirt",
    "ar": "قميص بولو",
    "group": "tops"
  },
  {
    "kind": "cargo",
    "en": "Cargo trousers",
    "ar": "بنطال بجيوب جانبية",
    "group": "bottoms"
  },
  {
    "kind": "belt",
    "en": "Belt",
    "ar": "حزام",
    "group": "accessories"
  },
  {
    "kind": "cap",
    "en": "Cap",
    "ar": "قبعة",
    "group": "headwear"
  },
  {
    "kind": "socks",
    "en": "Socks",
    "ar": "جوارب",
    "group": "accessories"
  },
  {
    "kind": "jacket",
    "en": "Field jacket",
    "ar": "سترة ميدانية",
    "group": "outerwear"
  },
  {
    "kind": "vest",
    "en": "Security vest",
    "ar": "سترة أمنية عاكسة",
    "group": "outerwear"
  },
  {
    "kind": "parka",
    "en": "Padded winter jacket",
    "ar": "سترة شتوية مبطنة",
    "group": "outerwear"
  },
  {
    "kind": "dressshirt",
    "en": "Formal shirt",
    "ar": "قميص رسمي",
    "group": "tops"
  },
  {
    "kind": "longsleeve",
    "en": "Long-sleeve polo",
    "ar": "قميص بولو بأكمام طويلة",
    "group": "tops"
  }
] as const satisfies readonly {
  kind: UniformArtKind
  en: string
  ar: string
  group: UniformArtGroup
}[]
