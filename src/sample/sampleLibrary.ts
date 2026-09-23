import type { Track } from "../core/types.js";

/**
 * 示例音乐库：开发与首次运行使用。
 *
 * 精选真实存在、网易云可按"歌名+歌手"检索的曲目，元数据标注接近真实听感。
 * 首次启动且本地库为空时自动导入，用户导入真实库后整体替换。
 * 该文件属于测试/演示夹具数据，不含任何用户私人数据。
 */

type Row = [
  id: string,
  title: string,
  artist: string,
  album: string | undefined,
  durationSec: number,
  language: string,
  isInstrumental: boolean,
  genres: string[],
  energy: number,
  moodTags: string[],
  vocalDensity: "none" | "low" | "medium" | "high",
];

const ROWS: Row[] = [
  // ---------- 钢琴 / 古典（安静纯音乐） ----------
  ["river-flows-in-you", "River Flows in You", "이루마", "First Love", 188, "instrumental", true, ["piano", "classical"], 0.2, ["calm", "dreamy"], "none"],
  ["kiss-the-rain", "Kiss the Rain", "이루마", "From The Yellow Room", 256, "instrumental", true, ["piano"], 0.2, ["calm", "soothing"], "none"],
  ["canon-in-d", "Canon in D", "Johann Pachelbel", undefined, 300, "instrumental", true, ["classical"], 0.3, ["calm", "bright"], "none"],
  ["clair-de-lune", "Clair de Lune", "Claude Debussy", undefined, 305, "instrumental", true, ["classical", "piano"], 0.2, ["calm", "dreamy"], "none"],
  ["nocturne-op9-2", "Nocturne No. 2 Op. 9", "Frédéric Chopin", undefined, 270, "instrumental", true, ["classical", "piano"], 0.25, ["calm", "warm"], "none"],
  ["gymnopedie-no1", "Gymnopédie No. 1", "Erik Satie", undefined, 180, "instrumental", true, ["classical", "piano"], 0.15, ["calm", "dreamy"], "none"],
  ["nuvole-bianche", "Nuvole Bianche", "Ludovico Einaudi", "Una Mattina", 357, "instrumental", true, ["piano", "classical"], 0.3, ["calm", "focus"], "none"],
  ["experience", "Experience", "Ludovico Einaudi", "In A Time Lapse", 312, "instrumental", true, ["piano", "classical"], 0.45, ["uplifting", "focus"], "none"],
  ["summer-kikujiro", "Summer", "久石譲", "菊次郎の夏", 196, "instrumental", true, ["piano", "soundtrack"], 0.4, ["bright", "uplifting"], "none"],
  ["the-rain", "The Rain", "久石譲", "菊次郎の夏", 336, "instrumental", true, ["piano", "soundtrack"], 0.3, ["calm", "melancholic"], "none"],
  ["merry-go-round", "人生のメリーゴーランド", "久石譲", "ハウルの動く城", 131, "instrumental", true, ["soundtrack", "classical"], 0.35, ["dreamy", "gentle"], "none"],
  ["comptine", "Comptine d'un autre été", "Yann Tiersen", "Amélie", 140, "instrumental", true, ["piano"], 0.25, ["melancholic", "calm"], "none"],
  ["la-valse-damelie", "La Valse d'Amélie", "Yann Tiersen", "Amélie", 135, "instrumental", true, ["piano"], 0.3, ["dreamy", "gentle"], "none"],
  ["avril-14th", "Avril 14th", "Aphex Twin", "Drukqs", 125, "instrumental", true, ["piano", "ambient"], 0.2, ["calm", "dreamy"], "none"],
  ["merry-christmas-mr-lawrence", "Merry Christmas Mr. Lawrence", "坂本龍一", undefined, 420, "instrumental", true, ["piano", "classical"], 0.25, ["melancholic", "calm"], "none"],
  ["on-the-nature-of-daylight", "On the Nature of Daylight", "Max Richter", "The Blue Notebooks", 360, "instrumental", true, ["classical", "soundtrack"], 0.25, ["melancholic", "calm", "soothing"], "none"],
  ["near-light", "Near Light", "Ólafur Arnalds", "For Now I Am Winter", 250, "instrumental", true, ["piano", "classical"], 0.3, ["calm", "focus"], "none"],
  ["huan-qin", "欢沁", "林海", "琵琶相", 220, "instrumental", true, ["classical"], 0.3, ["bright", "gentle"], "none"],

  // ---------- Lo-Fi / Chillhop（专注伴奏） ----------
  ["snowman", "Snowman", "WYS", undefined, 146, "instrumental", true, ["lofi"], 0.25, ["calm", "dreamy"], "none"],
  ["frostbite", "Frostbite", "Purrple Cat", undefined, 200, "instrumental", true, ["lofi"], 0.25, ["calm", "dreamy"], "none"],
  ["cinnamon", "Cinnamon", "Sleepermane", undefined, 180, "instrumental", true, ["lofi"], 0.3, ["calm", "focus"], "none"],
  ["affection", "Affection", "Jinsang", undefined, 150, "instrumental", true, ["lofi"], 0.25, ["calm", "warm"], "none"],
  ["aruarian-dance", "Aruarian Dance", "Nujabes", "Samurai Champloo Music Record", 263, "instrumental", true, ["lofi", "hiphop"], 0.3, ["calm", "groovy", "focus"], "none"],
  ["feather", "Feather", "Nujabes", "Modal Soul", 270, "instrumental", true, ["lofi", "hiphop"], 0.35, ["focus", "groovy"], "none"],
  ["luv-sic-part3", "Luv(sic) Part 3", "Nujabes", undefined, 290, "en", false, ["lofi", "hiphop"], 0.4, ["focus", "groovy"], "low"],
  ["dont-cry-dilla", "Don't Cry", "J Dilla", "Donuts", 120, "instrumental", true, ["hiphop", "lofi"], 0.3, ["gentle", "melancholic"], "none"],

  // ---------- 后摇 / 氛围电子（长段专注） ----------
  ["your-hand-in-mine", "Your Hand in Mine", "Explosions in the Sky", "The Earth Is Not a Cold Dead Place", 480, "instrumental", true, ["post-rock"], 0.5, ["uplifting", "focus"], "none"],
  ["ashes-in-the-snow", "Ashes in the Snow", "MONO", "Hymn to the Immortal Wind", 400, "instrumental", true, ["post-rock"], 0.45, ["melancholic", "dreamy"], "none"],
  ["hai-yang-zhi-xin", "海洋之心", "惘闻", "岁月鸿沟", 520, "instrumental", true, ["post-rock"], 0.5, ["focus", "dreamy"], "none"],
  ["goodbye-toe", "Goodbye", "toe", "For Long Tomorrow", 270, "instrumental", true, ["post-rock"], 0.5, ["groovy", "focus"], "none"],
  ["a-walk", "A Walk", "Tycho", "Dive", 330, "instrumental", true, ["electronic", "ambient"], 0.4, ["calm", "focus"], "none"],
  ["awake", "Awake", "Tycho", "Awake", 290, "instrumental", true, ["electronic"], 0.5, ["uplifting", "focus"], "none"],
  ["kerala", "Kerala", "Bonobo", "Migration", 247, "instrumental", true, ["electronic"], 0.5, ["groovy", "focus"], "none"],
  ["emerald-rush", "Emerald Rush", "Bonobo", "Migration", 300, "instrumental", true, ["electronic"], 0.5, ["groovy", "dreamy"], "none"],
  ["a-moment-apart", "A Moment Apart", "ODESZA", "A Moment Apart", 270, "instrumental", true, ["electronic"], 0.55, ["uplifting", "bright"], "none"],
  ["immunity", "Immunity", "Jon Hopkins", "Immunity", 330, "instrumental", true, ["electronic", "ambient"], 0.45, ["focus", "calm"], "none"],
  ["the-xx-intro", "Intro", "The xx", "xx", 128, "instrumental", true, ["electronic", "indie"], 0.4, ["calm", "focus"], "none"],
  ["harder-better-faster", "Harder, Better, Faster, Stronger", "Daft Punk", "Discovery", 224, "en", false, ["electronic"], 0.7, ["uplifting", "groovy"], "high"],
  ["something-about-us", "Something About Us", "Daft Punk", "Discovery", 193, "en", false, ["electronic"], 0.5, ["warm", "groovy"], "medium"],
  ["midnight-city", "Midnight City", "M83", "Hurry Up, We're Dreaming", 243, "en", false, ["electronic", "indie"], 0.65, ["uplifting", "bright"], "medium"],
  ["levels", "Levels", "Avicii", "Levels", 270, "instrumental", true, ["electronic"], 0.75, ["uplifting", "bright"], "none"],

  // ---------- 爵士 ----------
  ["waltz-for-debby", "Waltz for Debby", "Bill Evans Trio", "Waltz for Debby", 414, "instrumental", true, ["jazz"], 0.35, ["calm", "dreamy"], "none"],
  ["blue-in-green", "Blue in Green", "Miles Davis", "Kind of Blue", 337, "instrumental", true, ["jazz"], 0.25, ["melancholic", "calm"], "none"],
  ["dont-know-why", "Don't Know Why", "Norah Jones", "Come Away with Me", 186, "en", false, ["jazz"], 0.4, ["calm", "warm"], "medium"],
  ["almost-blue", "Almost Blue", "Chet Baker", undefined, 273, "en", false, ["jazz"], 0.3, ["melancholic", "gentle"], "low"],

  // ---------- City Pop / 日系 ----------
  ["plastic-love", "Plastic Love", "竹内まりや", "VARIETY", 283, "ja", false, ["city-pop"], 0.55, ["groovy", "melancholic"], "high"],
  ["stay-with-me", "真夜中のドア / Stay With Me", "松原みき", "POCKET PARK", 283, "ja", false, ["city-pop"], 0.55, ["groovy", "bright"], "high"],
  ["ride-on-time", "RIDE ON TIME", "山下達郎", "RIDE ON TIME", 240, "ja", false, ["city-pop"], 0.65, ["uplifting", "bright"], "high"],
  ["night-cruising", "ナイトクルージング", "フィッシュマンズ", "LONG SEASON", 300, "ja", false, ["city-pop", "indie"], 0.45, ["dreamy", "groovy"], "medium"],
  ["yoru-ni-akeru", "夜に駆ける", "YOASOBI", "THE BOOK", 271, "ja", false, ["acg", "pop"], 0.6, ["bright", "uplifting"], "high"],
  ["sparkle", "スパークル", "RADWIMPS", "君の名は。", 375, "ja", false, ["acg", "rock"], 0.5, ["dreamy", "uplifting"], "high"],
  ["brave-shine", "Brave Shine", "Aimer", "DAWN", 260, "ja", false, ["acg"], 0.55, ["uplifting", "focus"], "high"],
  ["gurenge", "紅蓮華", "LiSA", "LEO-NiNE", 304, "ja", false, ["acg", "rock"], 0.7, ["uplifting", "bright"], "high"],

  // ---------- 中文流行 / 民谣 / 摇滚 ----------
  ["qing-tian", "晴天", "周杰伦", "叶惠美", 269, "zh", false, ["pop"], 0.5, ["warm", "melancholic"], "high"],
  ["ye-qu", "夜曲", "周杰伦", "十一月的萧邦", 226, "zh", false, ["pop", "hiphop"], 0.5, ["melancholic", "focus"], "high"],
  ["pu-gong-ying", "蒲公英的约定", "周杰伦", "我很忙", 240, "zh", false, ["pop"], 0.4, ["calm", "gentle"], "high"],
  ["lv-xing-de-yi-yi", "旅行的意义", "陈绮贞", "Groupies 吉他手", 216, "zh", false, ["folk"], 0.35, ["gentle", "warm"], "medium"],
  ["yun-yan-cheng-yu", "云烟成雨", "房东的猫", "云烟成雨", 233, "zh", false, ["folk"], 0.3, ["calm", "melancholic"], "medium"],
  ["mei-hao-shi-wu", "美好事物", "房东的猫", "房东的猫", 250, "zh", false, ["folk"], 0.35, ["warm", "gentle"], "medium"],
  ["sha-si-shi-jia-zhuang", "杀死那个石家庄人", "万能青年旅店", "万能青年旅店", 325, "zh", false, ["rock"], 0.6, ["melancholic", "uplifting"], "high"],
  ["shan-hai", "山海", "草东没有派对", "丑奴儿", 300, "zh", false, ["rock"], 0.65, ["melancholic", "uplifting"], "high"],
  ["hao-jiu-bu-jian", "好久不见", "陈奕迅", "认了吧", 270, "zh", false, ["pop"], 0.4, ["melancholic", "calm"], "high"],
  ["wen-rou", "温柔", "五月天", "爱情万岁", 277, "zh", false, ["rock", "pop"], 0.5, ["warm", "gentle"], "high"],
  ["jue-jiang", "倔强", "五月天", "神的孩子都在跳舞", 300, "zh", false, ["rock"], 0.6, ["uplifting", "bright"], "high"],
  ["xiao-qing-ge", "小情歌", "苏打绿", "小宇宙", 265, "zh", false, ["pop"], 0.45, ["warm", "gentle"], "high"],
  ["ping-fan-zhi-lu", "平凡之路", "朴树", "猎户星座", 320, "zh", false, ["folk", "rock"], 0.5, ["melancholic", "uplifting"], "high"],
  ["ye-kong-zhong-zui-liang-de-xing", "夜空中最亮的星", "逃跑计划", "世界", 270, "zh", false, ["rock"], 0.55, ["uplifting", "warm"], "high"],
  ["cheng-du", "成都", "赵雷", "无法长大", 325, "zh", false, ["folk"], 0.4, ["warm", "gentle"], "medium"],
  ["ban-ma", "斑马，斑马", "宋冬野", "安和桥北", 300, "zh", false, ["folk"], 0.35, ["melancholic", "calm"], "medium"],
  ["tong-zhuo-de-ni", "同桌的你", "老狼", "恋恋风尘", 270, "zh", false, ["folk"], 0.35, ["warm", "gentle"], "medium"],
  ["nian-shao-you-wei", "年少有为", "李荣浩", "耳朵", 268, "zh", false, ["pop"], 0.45, ["melancholic", "warm"], "high"],
  ["bu-jian-chang-an", "不见长安", "河图", "风起天阑", 276, "zh", false, ["folk"], 0.35, ["dreamy", "calm"], "medium"],

  // ---------- 英文流行 / 独立 ----------
  ["sparks", "Sparks", "Coldplay", "Parachutes", 230, "en", false, ["pop", "indie"], 0.35, ["calm", "dreamy"], "medium"],
  ["viva-la-vida", "Viva La Vida", "Coldplay", "Viva La Vida", 245, "en", false, ["pop", "rock"], 0.65, ["uplifting", "bright"], "high"],
  ["photograph", "Photograph", "Ed Sheeran", "x", 258, "en", false, ["pop"], 0.45, ["warm", "gentle"], "medium"],
  ["ocean-eyes", "Ocean Eyes", "Billie Eilish", "dont smile at me", 200, "en", false, ["pop"], 0.3, ["dreamy", "calm"], "medium"],
  ["holocene", "Holocene", "Bon Iver", "Bon Iver", 336, "en", false, ["folk", "indie"], 0.35, ["calm", "melancholic"], "medium"],
  ["flightless-bird", "Flightless Bird, American Mouth", "Iron & Wine", "The Shepherd's Dog", 250, "en", false, ["folk"], 0.35, ["dreamy", "gentle"], "medium"],
  ["id-rather-dance", "I'd Rather Dance with You", "Kings of Convenience", "Riot on an Empty Street", 200, "en", false, ["indie", "folk"], 0.45, ["groovy", "bright"], "medium"],
  ["homesick-koc", "Homesick", "Kings of Convenience", "Riot on an Empty Street", 210, "en", false, ["indie", "folk"], 0.35, ["calm", "gentle"], "medium"],

  // ---------- 韩语 ----------
  ["bam-pyeonji", "밤편지", "IU", "Palette", 280, "ko", false, ["pop"], 0.35, ["calm", "warm"], "medium"],
  ["travel", "여행", "볼빨간사춘기", "RED ICKLE", 210, "ko", false, ["pop"], 0.5, ["bright", "gentle"], "medium"],
];

let cached: Track[] | undefined;

export function getSampleLibrary(): Track[] {
  if (cached) return cached;
  cached = ROWS.map(([id, title, artist, album, durationSec, language, isInstrumental, genres, energy, moodTags, vocalDensity]) => ({
    id,
    title,
    artist,
    album,
    durationSec,
    language,
    isInstrumental,
    genres,
    energy,
    moodTags,
    vocalDensity,
    source: { kind: "sample" },
    netease: { searchKeyword: `${title} ${artist}` },
  }));
  return cached;
}
