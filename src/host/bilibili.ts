/**
 * B 站视频课：从链接读出课程标题和每一集（分 P 或合集）。
 * 只用公开的视频信息接口，不登录、不读观看进度。
 */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36'

export interface VideoEpisode { title: string; url: string }
export interface VideoChapter { title: string; episodes: VideoEpisode[] }
export interface VideoCourse { title: string; url: string; chapters: VideoChapter[] }

export class VideoError extends Error {}

/** 从文本里找出 B 站链接或 BV 号。支持 b23.tv 短链。 */
export async function resolveBvid(input: string): Promise<string> {
  const direct = input.match(/BV[0-9A-Za-z]{10}/)
  if (direct) return direct[0]
  const short = input.match(/https?:\/\/b23\.tv\/[0-9A-Za-z]+/)
  if (short) {
    const response = await fetch(short[0], { redirect: 'follow', headers: { 'user-agent': UA } })
    const found = response.url.match(/BV[0-9A-Za-z]{10}/)
    if (found) return found[0]
  }
  throw new VideoError('没有识别到 B 站视频链接（需要包含 BV 号，或 b23.tv 短链）')
}

interface ViewData {
  bvid: string
  title: string
  pages?: { page: number; part: string }[]
  ugc_season?: {
    title: string
    sections: { title: string; episodes: { title: string; bvid: string }[] }[]
  }
}

async function view(bvid: string): Promise<ViewData> {
  const response = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
    headers: { 'user-agent': UA, referer: 'https://www.bilibili.com/' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new VideoError(`B 站接口请求失败（HTTP ${response.status}）`)
  const body = await response.json() as { code: number; message?: string; data?: ViewData }
  if (body.code !== 0 || body.data === undefined) throw new VideoError(`B 站返回错误：${body.message ?? body.code}`)
  return body.data
}

/**
 * 读取课程：
 * - 多分 P 的视频：每个分 P 是一集，链接 ?p=N；
 * - 单 P 但属于合集：合集里每个视频是一集，合集的分区是章；
 * - 都不是：只有一集。
 */
export async function readVideoCourse(input: string): Promise<VideoCourse> {
  const bvid = await resolveBvid(input)
  const data = await view(bvid)
  const base = `https://www.bilibili.com/video/${data.bvid}`
  const pages = data.pages ?? []
  if (pages.length > 1) {
    return {
      title: data.title,
      url: base,
      chapters: [{
        title: '全部视频',
        episodes: pages.map(p => ({ title: p.part || `第 ${p.page} 集`, url: `${base}?p=${p.page}` })),
      }],
    }
  }
  const season = data.ugc_season
  if (season !== undefined && season.sections.some(s => s.episodes.length > 1)) {
    const chapters = season.sections
      .filter(s => s.episodes.length > 0)
      .map(s => ({
        title: season.sections.length === 1 ? '全部视频' : s.title,
        episodes: s.episodes.map(e => ({ title: e.title, url: `https://www.bilibili.com/video/${e.bvid}` })),
      }))
    return { title: season.title || data.title, url: base, chapters }
  }
  return { title: data.title, url: base, chapters: [{ title: '全部视频', episodes: [{ title: data.title, url: base }] }] }
}
