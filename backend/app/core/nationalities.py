"""Inmate-only nationality registry for monthly conduct-violation statistics.

Labels in this registry are persisted identifiers: add a label or alias, but never
edit one in place. Closed monthly registers keep their frozen labels and are never
re-resolved through this registry.
"""

import unicodedata
from collections.abc import Mapping
from types import MappingProxyType
from typing import Final, NamedTuple

NATIONALITY_CODE_UAE: Final = "AE"
NATIONALITY_CODE_STATELESS: Final = "XB"
NATIONALITY_CODE_UNSPECIFIED: Final = "XX"


class Nationality(NamedTuple):
    code: str
    label_ar: str
    label_en: str
    selectable: bool


NATIONALITIES: Final[tuple[Nationality, ...]] = (
    Nationality("AD", "أندورا", "Andorra", True),
    Nationality("AE", "الإمارات", "United Arab Emirates", True),
    Nationality("AF", "أفغانستان", "Afghanistan", True),
    Nationality("AG", "أنتيغوا وبربودا", "Antigua and Barbuda", True),
    Nationality("AI", "أنغويلا", "Anguilla", True),
    Nationality("AL", "ألبانيا", "Albania", True),
    Nationality("AM", "أرمينيا", "Armenia", True),
    Nationality("AO", "أنغولا", "Angola", True),
    Nationality("AQ", "أنتاركتيكا", "Antarctica", True),
    Nationality("AR", "الأرجنتين", "Argentina", True),
    Nationality("AS", "ساموا الأمريكية", "American Samoa", True),
    Nationality("AT", "النمسا", "Austria", True),
    Nationality("AU", "أستراليا", "Australia", True),
    Nationality("AW", "أروبا", "Aruba", True),
    Nationality("AX", "جزر آلاند", "Åland Islands", True),
    Nationality("AZ", "أذربيجان", "Azerbaijan", True),
    Nationality("BA", "البوسنة والهرسك", "Bosnia and Herzegovina", True),
    Nationality("BB", "بربادوس", "Barbados", True),
    Nationality("BD", "بنغلاديش", "Bangladesh", True),
    Nationality("BE", "بلجيكا", "Belgium", True),
    Nationality("BF", "بوركينا فاسو", "Burkina Faso", True),
    Nationality("BG", "بلغاريا", "Bulgaria", True),
    Nationality("BH", "البحرين", "Bahrain", True),
    Nationality("BI", "بوروندي", "Burundi", True),
    Nationality("BJ", "بنين", "Benin", True),
    Nationality("BL", "سان بارتليمي", "Saint Barthélemy", True),
    Nationality("BM", "برمودا", "Bermuda", True),
    Nationality("BN", "بروناي", "Brunei Darussalam", True),
    Nationality("BO", "بوليفيا", "Bolivia, Plurinational State of", True),
    Nationality("BQ", "هولندا الكاريبية", "Bonaire, Sint Eustatius and Saba", True),
    Nationality("BR", "البرازيل", "Brazil", True),
    Nationality("BS", "جزر البهاما", "Bahamas", True),
    Nationality("BT", "بوتان", "Bhutan", True),
    Nationality("BV", "جزيرة بوفيه", "Bouvet Island", True),
    Nationality("BW", "بوتسوانا", "Botswana", True),
    Nationality("BY", "بيلاروس", "Belarus", True),
    Nationality("BZ", "بليز", "Belize", True),
    Nationality("CA", "كندا", "Canada", True),
    Nationality("CC", "جزر كوكوس (كيلينغ)", "Cocos (Keeling) Islands", True),
    Nationality("CD", "الكونغو - كينشاسا", "Congo, The Democratic Republic of the", True),
    Nationality("CF", "جمهورية أفريقيا الوسطى", "Central African Republic", True),
    Nationality("CG", "الكونغو - برازافيل", "Congo", True),
    Nationality("CH", "سويسرا", "Switzerland", True),
    Nationality("CI", "ساحل العاج", "Côte d'Ivoire", True),
    Nationality("CK", "جزر كوك", "Cook Islands", True),
    Nationality("CL", "تشيلي", "Chile", True),
    Nationality("CM", "الكاميرون", "Cameroon", True),
    Nationality("CN", "الصين", "China", True),
    Nationality("CO", "كولومبيا", "Colombia", True),
    Nationality("CR", "كوستاريكا", "Costa Rica", True),
    Nationality("CU", "كوبا", "Cuba", True),
    Nationality("CV", "الرأس الأخضر", "Cabo Verde", True),
    Nationality("CW", "كوراساو", "Curaçao", True),
    Nationality("CX", "جزيرة كريسماس", "Christmas Island", True),
    Nationality("CY", "قبرص", "Cyprus", True),
    Nationality("CZ", "التشيك", "Czechia", True),
    Nationality("DE", "ألمانيا", "Germany", True),
    Nationality("DJ", "جيبوتي", "Djibouti", True),
    Nationality("DK", "الدانمرك", "Denmark", True),
    Nationality("DM", "دومينيكا", "Dominica", True),
    Nationality("DO", "جمهورية الدومينيكان", "Dominican Republic", True),
    Nationality("DZ", "الجزائر", "Algeria", True),
    Nationality("EC", "الإكوادور", "Ecuador", True),
    Nationality("EE", "إستونيا", "Estonia", True),
    Nationality("EG", "مصر", "Egypt", True),
    Nationality("EH", "الصحراء الغربية", "Western Sahara", True),
    Nationality("ER", "إريتريا", "Eritrea", True),
    Nationality("ES", "إسبانيا", "Spain", True),
    Nationality("ET", "إثيوبيا", "Ethiopia", True),
    Nationality("FI", "فنلندا", "Finland", True),
    Nationality("FJ", "فيجي", "Fiji", True),
    Nationality("FK", "جزر فوكلاند", "Falkland Islands (Malvinas)", True),
    Nationality("FM", "ميكرونيزيا", "Micronesia, Federated States of", True),
    Nationality("FO", "جزر فارو", "Faroe Islands", True),
    Nationality("FR", "فرنسا", "France", True),
    Nationality("GA", "الغابون", "Gabon", True),
    Nationality("GB", "المملكة المتحدة", "United Kingdom", True),
    Nationality("GD", "غرينادا", "Grenada", True),
    Nationality("GE", "جورجيا", "Georgia", True),
    Nationality("GF", "غويانا الفرنسية", "French Guiana", True),
    Nationality("GG", "غيرنزي", "Guernsey", True),
    Nationality("GH", "غانا", "Ghana", True),
    Nationality("GI", "جبل طارق", "Gibraltar", True),
    Nationality("GL", "غرينلاند", "Greenland", True),
    Nationality("GM", "غامبيا", "Gambia", True),
    Nationality("GN", "غينيا", "Guinea", True),
    Nationality("GP", "غوادلوب", "Guadeloupe", True),
    Nationality("GQ", "غينيا الاستوائية", "Equatorial Guinea", True),
    Nationality("GR", "اليونان", "Greece", True),
    Nationality(
        "GS",
        "جورجيا الجنوبية وجزر ساندويتش الجنوبية",
        "South Georgia and the South Sandwich Islands",
        True,
    ),
    Nationality("GT", "غواتيمالا", "Guatemala", True),
    Nationality("GU", "غوام", "Guam", True),
    Nationality("GW", "غينيا بيساو", "Guinea-Bissau", True),
    Nationality("GY", "غيانا", "Guyana", True),
    Nationality("HK", "هونغ كونغ الصينية (منطقة إدارية خاصة)", "Hong Kong", True),
    Nationality("HM", "جزيرة هيرد وجزر ماكدونالد", "Heard Island and McDonald Islands", True),
    Nationality("HN", "هندوراس", "Honduras", True),
    Nationality("HR", "كرواتيا", "Croatia", True),
    Nationality("HT", "هايتي", "Haiti", True),
    Nationality("HU", "هنغاريا", "Hungary", True),
    Nationality("ID", "إندونيسيا", "Indonesia", True),
    Nationality("IE", "أيرلندا", "Ireland", True),
    Nationality("IL", "إسرائيل", "Israel", True),
    Nationality("IM", "جزيرة مان", "Isle of Man", True),
    Nationality("IN", "الهند", "India", True),
    Nationality("IO", "الإقليم البريطاني في المحيط الهندي", "British Indian Ocean Territory", True),
    Nationality("IQ", "العراق", "Iraq", True),
    Nationality("IR", "إيران", "Iran, Islamic Republic of", True),
    Nationality("IS", "آيسلندا", "Iceland", True),
    Nationality("IT", "إيطاليا", "Italy", True),
    Nationality("JE", "جيرسي", "Jersey", True),
    Nationality("JM", "جامايكا", "Jamaica", True),
    Nationality("JO", "الأردن", "Jordan", True),
    Nationality("JP", "اليابان", "Japan", True),
    Nationality("KE", "كينيا", "Kenya", True),
    Nationality("KG", "قيرغيزستان", "Kyrgyzstan", True),
    Nationality("KH", "كمبوديا", "Cambodia", True),
    Nationality("KI", "كيريباتي", "Kiribati", True),
    Nationality("KM", "جزر القمر", "Comoros", True),
    Nationality("KN", "سانت كيتس ونيفيس", "Saint Kitts and Nevis", True),
    Nationality("KP", "كوريا الشمالية", "Korea, Democratic People's Republic of", True),
    Nationality("KR", "كوريا الجنوبية", "Korea, Republic of", True),
    Nationality("KW", "الكويت", "Kuwait", True),
    Nationality("KY", "جزر كايمان", "Cayman Islands", True),
    Nationality("KZ", "كازاخستان", "Kazakhstan", True),
    Nationality("LA", "لاوس", "Lao People's Democratic Republic", True),
    Nationality("LB", "لبنان", "Lebanon", True),
    Nationality("LC", "سانت لوسيا", "Saint Lucia", True),
    Nationality("LI", "ليختنشتاين", "Liechtenstein", True),
    Nationality("LK", "سريلانكا", "Sri Lanka", True),
    Nationality("LR", "ليبيريا", "Liberia", True),
    Nationality("LS", "ليسوتو", "Lesotho", True),
    Nationality("LT", "ليتوانيا", "Lithuania", True),
    Nationality("LU", "لوكسمبورغ", "Luxembourg", True),
    Nationality("LV", "لاتفيا", "Latvia", True),
    Nationality("LY", "ليبيا", "Libya", True),
    Nationality("MA", "المغرب", "Morocco", True),
    Nationality("MC", "موناكو", "Monaco", True),
    Nationality("MD", "مولدوفا", "Moldova, Republic of", True),
    Nationality("ME", "الجبل الأسود", "Montenegro", True),
    Nationality("MF", "سان مارتن", "Saint Martin (French part)", True),
    Nationality("MG", "مدغشقر", "Madagascar", True),
    Nationality("MH", "جزر مارشال", "Marshall Islands", True),
    Nationality("MK", "مقدونيا الشمالية", "North Macedonia", True),
    Nationality("ML", "مالي", "Mali", True),
    Nationality("MM", "ميانمار (بورما)", "Myanmar", True),
    Nationality("MN", "منغوليا", "Mongolia", True),
    Nationality("MO", "منطقة ماكاو الإدارية الخاصة", "Macao", True),
    Nationality("MP", "جزر ماريانا الشمالية", "Northern Mariana Islands", True),
    Nationality("MQ", "جزر المارتينيك", "Martinique", True),
    Nationality("MR", "موريتانيا", "Mauritania", True),
    Nationality("MS", "مونتسرات", "Montserrat", True),
    Nationality("MT", "مالطا", "Malta", True),
    Nationality("MU", "موريشيوس", "Mauritius", True),
    Nationality("MV", "جزر المالديف", "Maldives", True),
    Nationality("MW", "ملاوي", "Malawi", True),
    Nationality("MX", "المكسيك", "Mexico", True),
    Nationality("MY", "ماليزيا", "Malaysia", True),
    Nationality("MZ", "موزمبيق", "Mozambique", True),
    Nationality("NA", "ناميبيا", "Namibia", True),
    Nationality("NC", "كاليدونيا الجديدة", "New Caledonia", True),
    Nationality("NE", "النيجر", "Niger", True),
    Nationality("NF", "جزيرة نورفولك", "Norfolk Island", True),
    Nationality("NG", "نيجيريا", "Nigeria", True),
    Nationality("NI", "نيكاراغوا", "Nicaragua", True),
    Nationality("NL", "هولندا", "Netherlands", True),
    Nationality("NO", "النرويج", "Norway", True),
    Nationality("NP", "نيبال", "Nepal", True),
    Nationality("NR", "ناورو", "Nauru", True),
    Nationality("NU", "نيوي", "Niue", True),
    Nationality("NZ", "نيوزيلندا", "New Zealand", True),
    Nationality("OM", "عُمان", "Oman", True),
    Nationality("PA", "بنما", "Panama", True),
    Nationality("PE", "بيرو", "Peru", True),
    Nationality("PF", "بولينيزيا الفرنسية", "French Polynesia", True),
    Nationality("PG", "بابوا غينيا الجديدة", "Papua New Guinea", True),
    Nationality("PH", "الفلبين", "Philippines", True),
    Nationality("PK", "باكستان", "Pakistan", True),
    Nationality("PL", "بولندا", "Poland", True),
    Nationality("PM", "سان بيير ومكويلون", "Saint Pierre and Miquelon", True),
    Nationality("PN", "جزر بيتكيرن", "Pitcairn", True),
    Nationality("PR", "بورتوريكو", "Puerto Rico", True),
    Nationality("PS", "الأراضي الفلسطينية", "Palestine, State of", True),
    Nationality("PT", "البرتغال", "Portugal", True),
    Nationality("PW", "بالاو", "Palau", True),
    Nationality("PY", "باراغواي", "Paraguay", True),
    Nationality("QA", "قطر", "Qatar", True),
    Nationality("RE", "روينيون", "Réunion", True),
    Nationality("RO", "رومانيا", "Romania", True),
    Nationality("RS", "صربيا", "Serbia", True),
    Nationality("RU", "روسيا", "Russian Federation", True),
    Nationality("RW", "رواندا", "Rwanda", True),
    Nationality("SA", "السعودية", "Saudi Arabia", True),
    Nationality("SB", "جزر سليمان", "Solomon Islands", True),
    Nationality("SC", "سيشل", "Seychelles", True),
    Nationality("SD", "السودان", "Sudan", True),
    Nationality("SE", "السويد", "Sweden", True),
    Nationality("SG", "سنغافورة", "Singapore", True),
    Nationality("SH", "سانت هيلينا", "Saint Helena, Ascension and Tristan da Cunha", True),
    Nationality("SI", "سلوفينيا", "Slovenia", True),
    Nationality("SJ", "سفالبارد وجان ماين", "Svalbard and Jan Mayen", True),
    Nationality("SK", "سلوفاكيا", "Slovakia", True),
    Nationality("SL", "سيراليون", "Sierra Leone", True),
    Nationality("SM", "سان مارينو", "San Marino", True),
    Nationality("SN", "السنغال", "Senegal", True),
    Nationality("SO", "الصومال", "Somalia", True),
    Nationality("SR", "سورينام", "Suriname", True),
    Nationality("SS", "جنوب السودان", "South Sudan", True),
    Nationality("ST", "ساو تومي وبرينسيبي", "Sao Tome and Principe", True),
    Nationality("SV", "السلفادور", "El Salvador", True),
    Nationality("SX", "سانت مارتن", "Sint Maarten (Dutch part)", True),
    Nationality("SY", "سوريا", "Syrian Arab Republic", True),
    Nationality("SZ", "إسواتيني", "Eswatini", True),
    Nationality("TC", "جزر توركس وكايكوس", "Turks and Caicos Islands", True),
    Nationality("TD", "تشاد", "Chad", True),
    Nationality("TF", "الأقاليم الجنوبية الفرنسية", "French Southern Territories", True),
    Nationality("TG", "توغو", "Togo", True),
    Nationality("TH", "تايلاند", "Thailand", True),
    Nationality("TJ", "طاجيكستان", "Tajikistan", True),
    Nationality("TK", "توكيلاو", "Tokelau", True),
    Nationality("TL", "تيمور - ليشتي", "Timor-Leste", True),
    Nationality("TM", "تركمانستان", "Turkmenistan", True),
    Nationality("TN", "تونس", "Tunisia", True),
    Nationality("TO", "تونغا", "Tonga", True),
    Nationality("TR", "تركيا", "Türkiye", True),
    Nationality("TT", "ترينيداد وتوباغو", "Trinidad and Tobago", True),
    Nationality("TV", "توفالو", "Tuvalu", True),
    Nationality("TW", "تايوان", "Taiwan, Province of China", True),
    Nationality("TZ", "تنزانيا", "Tanzania, United Republic of", True),
    Nationality("UA", "أوكرانيا", "Ukraine", True),
    Nationality("UG", "أوغندا", "Uganda", True),
    Nationality("UM", "جزر الولايات المتحدة النائية", "United States Minor Outlying Islands", True),
    Nationality("US", "الولايات المتحدة", "United States", True),
    Nationality("UY", "أورغواي", "Uruguay", True),
    Nationality("UZ", "أوزبكستان", "Uzbekistan", True),
    Nationality("VA", "الفاتيكان", "Holy See (Vatican City State)", True),
    Nationality("VC", "سانت فنسنت وجزر غرينادين", "Saint Vincent and the Grenadines", True),
    Nationality("VE", "فنزويلا", "Venezuela, Bolivarian Republic of", True),
    Nationality("VG", "جزر فيرجن البريطانية", "Virgin Islands, British", True),
    Nationality("VI", "جزر فيرجن الأمريكية", "Virgin Islands, U.S.", True),
    Nationality("VN", "فيتنام", "Viet Nam", True),
    Nationality("VU", "فانواتو", "Vanuatu", True),
    Nationality("WF", "جزر والس وفوتونا", "Wallis and Futuna", True),
    Nationality("WS", "ساموا", "Samoa", True),
    Nationality("YE", "اليمن", "Yemen", True),
    Nationality("YT", "مايوت", "Mayotte", True),
    Nationality("ZA", "جنوب أفريقيا", "South Africa", True),
    Nationality("ZM", "زامبيا", "Zambia", True),
    Nationality("ZW", "زيمبابوي", "Zimbabwe", True),
    Nationality("XB", "بدون", "Stateless", True),
    Nationality("XX", "غير محدد", "Unspecified", False),
)


_NORMALIZATION_TRANSLATION: Final[Mapping[int, str | None]] = MappingProxyType(
    {
        **dict.fromkeys(range(0x064B, 0x0653)),
        **dict.fromkeys(range(0x06D6, 0x06EE)),
        ord("ـ"): None,
        ord("ٰ"): None,
        ord("أ"): "\u0627",
        ord("إ"): "\u0627",
        ord("آ"): "\u0627",
    }
)


def normalize_nationality(raw: str | None) -> str:
    """Return the stable lookup form for a stored nationality label.

    Normalization applies NFKC, removes tatweel and Arabic diacritics, collapses
    whitespace, case-folds Latin text, and folds hamzated and madda alef forms to
    bare Arabic alef. It deliberately preserves alef maqsura and ta marbuta:
    changing them would erase spelling distinctions beyond the historical variants
    this registry can justify.
    """

    if raw is None:
        return ""
    normalized = unicodedata.normalize("NFKC", raw).translate(_NORMALIZATION_TRANSLATION)
    return " ".join(normalized.split()).casefold()


_HISTORICAL_ALIASES: Final[Mapping[str, str]] = MappingProxyType(
    {
        "الإمارات العربية المتحدة": "AE",
        "دولة الإمارات العربية المتحدة": "AE",
        "UAE": "AE",
        "U.A.E": "AE",
        "Emirates": "AE",
        "المملكة العربية السعودية": "SA",
        "سعودي": "SA",
        "سلطنة عُمان": "OM",
        "سلطنة عمان": "OM",
        "Oman, Sultanate of": "OM",
        "أمريكا": "US",
        "الولايات المتحدة الأمريكية": "US",
        "الولايات المتحده الامريكيه": "US",
        "America": "US",
        "USA": "US",
        "U.S.A.": "US",
        "United States of America": "US",
        "فلبيني": "PH",
        "Filipino": "PH",
        "سري لانكا": "LK",
        "Ceylon": "LK",
        "بنجلاديش": "BD",
        "Bangla Desh": "BD",
        "سورية": "SY",
        "Syrian Arab Republic": "SY",
        "Czech Republic": "CZ",
        "Swaziland": "SZ",
        "سوازيلاند": "SZ",
        "Burma": "MM",
        "برما": "MM",
        "East Timor": "TL",
        "تيمور الشرقية": "TL",
        "Cape Verde": "CV",
        "Turkey": "TR",
        "Macedonia": "MK",
        "مقدونيا": "MK",
        "FYROM": "MK",
        "Ivory Coast": "CI",
        "Côte d\u2019Ivoire": "CI",
        "Zaire": "CD",
        "زائير": "CD",
        "DR Congo": "CD",
        "Democratic Republic of the Congo": "CD",
        "Congo - Kinshasa": "CD",
        "Republic of the Congo": "CG",
        "Congo - Brazzaville": "CG",
        "Vatican City": "VA",
        "Holy See": "VA",
        "Palestine": "PS",
        "الأراضي الفلسطينية": "PS",
        "Bolivia": "BO",
        "Venezuela": "VE",
        "Tanzania": "TZ",
        "Moldova": "MD",
        "Laos": "LA",
        "Vietnam": "VN",
        "Viet Nam": "VN",
        "Brunei": "BN",
        "Micronesia": "FM",
        "North Korea": "KP",
        "South Korea": "KR",
        "Russia": "RU",
        "Russian Federation": "RU",
        "Iran": "IR",
        "Taiwan": "TW",
    }
)

_NATIONALITIES_BY_CODE: Final[Mapping[str, Nationality]] = MappingProxyType(
    {nationality.code: nationality for nationality in NATIONALITIES}
)

NATIONALITY_ALIASES: Final[Mapping[str, str]] = MappingProxyType(
    {
        **{
            normalize_nationality(label): nationality.code
            for nationality in NATIONALITIES
            for label in (nationality.label_ar, nationality.label_en)
        },
        **{normalize_nationality(label): code for label, code in _HISTORICAL_ALIASES.items()},
    }
)


def nationality_by_code(code: str) -> Nationality | None:
    """Return the registry entry for an exact alpha-2 or sentinel code."""

    return _NATIONALITIES_BY_CODE.get(code)


def resolve_nationality(raw: str | None) -> Nationality | None:
    """Resolve a stored label; blanks stay absent and unknown text becomes XX."""

    normalized = normalize_nationality(raw)
    if not normalized:
        return None
    code = NATIONALITY_ALIASES.get(normalized, NATIONALITY_CODE_UNSPECIFIED)
    return _NATIONALITIES_BY_CODE[code]


def is_citizen(code: str) -> bool:
    """Return whether code denotes a UAE citizen."""

    return code == NATIONALITY_CODE_UAE
