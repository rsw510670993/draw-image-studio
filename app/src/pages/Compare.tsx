import { Sparkles } from 'lucide-react'

interface Props {
  onToast: (text: string) => void
}

export default function Compare({ onToast }: Props) {
  return (
    <div className="compare">
      <div className="compare-intro panel">
        <div>
          <h2>同一提示词，两个通道并排看</h2>
          <p>GPT 订阅擅长语义理解与风格迁移，即梦在中文审美与 2K/4K 细节上更稳。对比页会把同一次生成同时派给两条通道。</p>
        </div>
        <span className="badge-p1">P1 · 接入后启用</span>
      </div>

      <div className="compare-grid">
        <section className="compare-col panel">
          <header>
            <span className="seg-dot gpt" />
            <b>ChatGPT 订阅</b>
            <em>gpt-image-2.5-flare</em>
          </header>
          <div className="compare-img compare-placeholder gpt">
            <span>ChatGPT · 接入后显示对比结果</span>
          </div>
          <p className="compare-cap">产品静物，硬光，深色背景 — 示例</p>
        </section>

        <section className="compare-col panel">
          <header>
            <span className="seg-dot jimeng" />
            <b>即梦 · Seedream 5.0 Lite</b>
            <em>2K</em>
          </header>
          <div className="compare-img compare-placeholder jimeng">
            <span>即梦 · 待接入</span>
          </div>
          <p className="compare-cap">产品静物，硬光，深色背景 — 示例</p>
        </section>
      </div>

      <div className="compare-foot">
        <button className="btn-primary" onClick={() => onToast('对比生成接入后启用')}>
          <Sparkles size={16} /> 发起一次对比
        </button>
        <span>接入后会显示两条通道的耗时、积分与成本对比</span>
      </div>
    </div>
  )
}
