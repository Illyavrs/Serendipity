import Link from 'next/link';
import { documents } from '@/lib/docs-navigation';

const guides: { slug: keyof typeof documents; title: string; summary: string }[] = [
  {
    slug: 'rewards',
    title: '任務、星塵與稱號',
    summary: '每週任務、兌換獎勵，以及個人頁稱號與頭像框。',
  },
  {
    slug: 'scores-and-pp',
    title: '成績、pp 與 Relax',
    summary: '成績怎麼驗證、pp 怎麼算，以及 Relax 分區。',
  },
  {
    slug: 'beatmaps',
    title: '圖譜搜尋、下載與申請排名',
    summary: '搜尋官方與伺服器圖譜、下載 .osz、上傳與申請排名。',
  },
  {
    slug: 'account',
    title: '帳號、安全與隱私',
    summary: '忘記密碼、登入裝置與外觀設定的保存方式。',
  },
  {
    slug: 'markdown',
    title: 'Markdown 格式',
    summary: '個人頁、公告與申請理由可以使用的格式與限制。',
  },
];

export default function Page() {
  return (
    <div className="page-container">
      <h1 className="docs-index-title">玩家說明</h1>
      <p className="docs-index-lede">
        怎麼連線請看 <Link href="/connect">連線教學</Link>。以下是遊玩與使用網站時常用的說明。
      </p>
      <ul className="docs-index-list">
        {guides.map((guide) => (
          <li key={guide.slug}>
            <Link href={`/docs/${guide.slug}`}>
              <strong>{guide.title}</strong>
              <span>{guide.summary}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
