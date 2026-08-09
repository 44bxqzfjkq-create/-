# 株式分析システム (stocksys)

日本株を **業績・財務・バリュエーション・成長性・株価・市場期待・リスク** など
多面的に分析し、人間が投資判断できる材料をレポートとして整えるシステムです。

> **これは投資助言ツールではありません。** スコアは「注目度」であって
> 「買い推奨」ではなく、最終的な投資判断は利用者自身が行います。

設計思想の詳細は [`docs/`](docs/) を参照:
- 設計書（ウェブ版）: `docs/design-site.html`
- 設計書（Markdown）: `docs/stock-analysis-system-design.md`

---

## クイックスタート（30秒・登録不要）

同梱の**サンプルデータ**（オフラインで動く合成データ）で、すぐに動作を確認できます。

```bash
pip install -r requirements.txt      # pandas と PyYAML のみで動きます

python -m stocksys list              # 対象銘柄の一覧
python -m stocksys analyze 7203 --html   # 1銘柄の総合分析（Markdown + HTML）
python -m stocksys screen --preset value_growth   # スクリーニング
python -m stocksys compare 7203 6758 6861         # 企業比較
```

出力は `reports/` に保存されます。

> ⚠ サンプルデータの株価・財務は**合成データ**で、実際の市場データではありません。
> 会社名・業種などの識別情報のみ実在の公開情報です。生成されるレポートには
> 必ず「サンプルデータ」の注意書きが付きます。

---

## 実データで動かす（yfinance）

ネットワークの通る環境（手元のPCなど）では、Yahoo Finance から実データを取得できます。

```bash
pip install yfinance
python -m stocksys --provider yfinance analyze 7203 --html
```

または `config/settings.yaml` の `provider:` を `yfinance` に変更します。

> 注: 一部のクラウド/CI環境では外部サイトへの通信が制限され、yfinance が使えない
> 場合があります。その場合は `sample` プロバイダをご利用ください。

---

## コマンド一覧

| コマンド | 説明 |
|---|---|
| `list` | プロバイダと対象ユニバースを表示 |
| `analyze <code> [--html] [--stdout]` | 1銘柄の総合分析レポート（11モジュール＋総合スコア） |
| `screen --preset <name>` | ユニバースを条件でスクリーニング（通過/非通過の内訳つき） |
| `compare <code> <code> ...` | 複数銘柄を同一基準で横並び比較 |

共通オプション: `--provider sample|yfinance`、`--config <path>`

---

## 設定 (`config/settings.yaml`)

コードを変えずに挙動を調整できます。

- `provider` — データ源（`sample` / `yfinance`）
- `universe` — 分析対象の銘柄コード
- `weights` — 総合スコアの重み、リスク/反証ペナルティの強さ
- `screening.presets` — スクリーニング条件（例 `"per <= 25"`）とプリセット
- `screening.exclude` — 除外条件

---

## アーキテクチャ

```
config/settings.yaml         設定（データ源・ユニバース・重み・スクリーニング条件）
data/sample/                 同梱デモデータ（合成）
stocksys/
  providers/                 L1 データ取得（sample / yfinance、差し替え可能）
  provenance.py              出典記録（すべての取得に来歴を付与）
  indicators.py              L2 指標計算（分析とスクリーニングの共通の指標源）
  analysis/
    modules.py               L3 分析エンジン（既存11方針＝11モジュール）
    scoring.py               総合スコア（リスク/反証はペナルティ）
  screening.py               L4 スクリーニング
  comparison.py              L4 企業比較
  reporting/                 L5 Markdown / HTML 出力
  engine.py                  取得→指標→分析→スコアの統合パイプライン
  cli.py                     コマンド入口
reports/                     出力先
```

### 11分析モジュール

`performance`（業績）, `earnings`（決算）, `financials`（財務）,
`valuation`（バリュエーション）, `growth`（成長性）, `price_action`（株価）,
`market_expectation`（市場期待）, `hypothesis`（投資仮説）,
`counter_analysis`（反証）, `risk`（リスク）, `investor_views`（複数投資家視点）

各モジュールは「指標 → 根拠つき所見 → サブスコア」を返し、
リスク・反証は総合スコアの**減点**として反映されます。データ不足の項目は
0点にせず「判定保留」と明示します。

---

## 実装状況（ロードマップ対応）

- [x] **フェーズ1 基盤**: プロバイダ層・出典記録・指標計算
- [x] **フェーズ2 分析＆スクリーニング**: 11モジュール・総合スコア・スクリーニング・Markdown/HTML
- [x] **フェーズ3 深掘り**: 決算分析・企業比較
- [ ] **フェーズ4 検証**: バックテスト（Point-in-Time・生存者バイアス対策）※次段階
- [ ] **フェーズ5 運用**: 監視リスト・変化検知・定期実行
- [ ] **フェーズ6 拡張**: J-Quants / EDINET / 有料コンセンサス統合

---

## サンプルデータの再生成

```bash
python scripts/make_sample_data.py
```
