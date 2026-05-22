/**
 * パラメータ説明の正本 (Issue #27)。
 *
 * lil-gui の各コントローラにホバーした際のツールチップ本文を、Settings 階層の
 * ドット記法パス (例: "pointCloud.bassExpansion") をキーに一元管理する。
 * SettingsPanel の `.name()` ラベルとは独立した正本であり、説明はここに集約する。
 */

export interface ParamDoc {
  /** そのパラメータが何か (1 文)。 */
  summary: string;
  /** 上げる / 下げる (または ON/OFF) と見た目がどう変わるか (効果方向)。 */
  effect: string;
}

/**
 * 設定オブジェクトの leaf (スカラ) パスをドット記法で再帰列挙する。
 * オブジェクト (非配列) は枝として降りる。配列・プリミティブは leaf。
 */
export function settingsLeafPaths(
  obj: unknown,
  prefix = "",
): string[] {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return prefix ? [prefix] : [];
  }
  const out: string[] = [];
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    out.push(...settingsLeafPaths(value, path));
  }
  return out;
}

/**
 * lil-gui Controller の `.object` / `.property` から doc キー (ドット記法パス)
 * を解決する。
 * - object が settings 本体 → property そのもの ("mode" 等)
 * - object が settings 直下のグループ → "<group>.<property>"
 * - settings 配下でない (reset/randomize 等のアクションボタン) → null
 */
export function resolveDocKey(
  settings: object,
  object: object,
  property: string,
): string | null {
  if (object === settings) return property;
  // settings 配下を再帰的に探索し、`object` と参照一致するノードのドット記法パスを返す。
  // edges.wave / edges.rewire のような入れ子グループに対応するため (Issue #31)。
  const stack: Array<{ node: unknown; path: string }> = [{ node: settings, path: "" }];
  while (stack.length > 0) {
    const { node, path } = stack.pop()!;
    if (node === null || typeof node !== "object" || Array.isArray(node)) continue;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (value === object) {
        return path ? `${path}.${key}.${property}` : `${key}.${property}`;
      }
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        stack.push({ node: value, path: path ? `${path}.${key}` : key });
      }
    }
  }
  return null;
}

/**
 * パラメータ説明マップ。キーは settings の leaf パス。
 * makeDefaultSettings() の全 leaf を網羅すること (param-docs.test.ts が検査)。
 */
export const PARAM_DOCS: Record<string, ParamDoc> = {
  mode: {
    summary: "粒子の配置・描画方式 (bones=体の点群 / cube・sphere=立体 / lattice=格子波 / image=画像ドット / rain=雨)。",
    effect: "切り替えると粒子の見え方が根本的に変わる。各モード専用パラメータは対応フォルダで調整する。",
  },
  audioSmoothing: {
    summary: "ゲイン適用後の音声特徴量にかける一次ローパス平滑化 (0..0.95)。",
    effect: "上げるほど反応が滑らかでゆったり追従。0 に近いほど瞬時に追従しチラつきやすい。",
  },

  "audioGain.volume": {
    summary: "全体音量をシェーダに渡す前に乗じるゲイン (0..5)。",
    effect: "上げるほど音量由来の動き (粒子サイズ等) が全体的に強く反応する。0 で音量反応なし。",
  },
  "audioGain.bass": {
    summary: "低音帯域に乗じるゲイン (0..5)。",
    effect: "上げるほど低音 (キック/ベース) で膨張・脈動・色相シフト等が強く出る。0 で低音反応なし。",
  },
  "audioGain.mid": {
    summary: "中音帯域に乗じるゲイン (0..5)。",
    effect: "上げるほど中音でドリフトや Z 押し出しが強く出る。0 で中音反応なし。",
  },
  "audioGain.treble": {
    summary: "高音帯域に乗じるゲイン (0..5)。",
    effect: "上げるほど高音で粒子のきらめき・輝度が強く出る。0 で高音反応なし。",
  },

  "pointCloud.bassExpansion": {
    summary: "低音に応じた各関節クラスタの放射状膨張量 (bones モード)。",
    effect: "上げるほど低音で点群が外側へ大きく弾ける。0 で膨張しない。",
  },
  "pointCloud.trebleShimmer": {
    summary: "高音駆動の粒子ごとの微振動振幅 (m)。",
    effect: "上げるほど高音で粒子が細かくちらつく。0 で高音による振動なし。",
  },
  "pointCloud.ambientShimmer": {
    summary: "音に関係なく常時かかる微振動振幅 (m)。",
    effect: "上げるほど無音でも粒子が常にゆらぐ。0 で完全静止 (音反応のみ)。",
  },
  "pointCloud.baseSize": {
    summary: "粒子の基準サイズ (px、遠近スケール前)。",
    effect: "上げるほど粒子が大きく密に見える。0 でほぼ見えなくなる。",
  },
  "pointCloud.volumeSize": {
    summary: "音量に応じて加算される粒子サイズ (px)。",
    effect: "上げるほど大音量時に粒子が大きく膨らむ。0 で音量によるサイズ変化なし。",
  },

  "fragmentField.driftBase": {
    summary: "空間の細片が常時漂うカールノイズの基本移動量。",
    effect: "上げるほど細片が常に速く流れる。0 で音反応がなければほぼ静止。",
  },
  "fragmentField.midDrift": {
    summary: "中音に応じて加算される漂い量。",
    effect: "上げるほど中音で細片の流れが激しくなる。0 で中音による流れの変化なし。",
  },
  "fragmentField.jointPull": {
    summary: "見えている関節へ細片を引き寄せる強さ。",
    effect: "上げるほど細片が体の形に集まる。0 で体に無関係に拡散する。",
  },
  "fragmentField.noiseScale": {
    summary: "カールノイズの空間スケール (高いほど乱れる)。",
    effect: "上げるほど流れが細かく乱流的に。下げるほど大きくうねるような流れになる。",
  },
  "fragmentField.timeSpeed": {
    summary: "カールノイズの時間発展速度。",
    effect: "上げるほど流れのパターンが速く移り変わる。0 で流れの形が固定される。",
  },

  "shape.radius": {
    summary: "cube の半辺長 / sphere の半径 (m)。",
    effect: "上げるほど立体が大きくなり画面を占有する。下げると小さくまとまる。",
  },
  "shape.bassPulse": {
    summary: "低音に応じた立体の放射状パルス強度。",
    effect: "上げるほど低音で立体が大きく脈動する。0 で脈動しない。",
  },

  "color.hueBase": {
    summary: "基準色相 (0..1, ループ。0=赤 0.33=緑 0.66=青)。",
    effect: "動かすと全体の色味が色相環上を移動する。見た目の基調色を決める。",
  },
  "color.hueSpread": {
    summary: "粒子ごとの色相の広がり (0..1)。",
    effect: "上げるほど虹色にばらける。0 で単色になる。",
  },
  "color.bassHueShift": {
    summary: "低音で駆動される色相シフト量 (0..1)。",
    effect: "上げるほどビートに合わせて色が大きく脈動する。0 で色が拍動しない。",
  },
  "color.saturation": {
    summary: "彩度 (0..1)。",
    effect: "上げるほど鮮やかな原色寄り。0 で白/グレーのモノクロになる。",
  },
  "color.trebleBoost": {
    summary: "高音駆動の輝度ブースト量。",
    effect: "上げるほど高音で全体がパッと明るく光る。0 で高音による増光なし。",
  },

  "camera.autoRotateSpeed": {
    summary: "OrbitControls の自動回転速度 (0=停止 / 正=時計回り / 負=反時計回り)。",
    effect: "絶対値を上げるほどカメラが速く周回する。0 で回転が止まる。",
  },

  "motion.target": {
    summary: "体の動きの大きさを乗算的に流し込む対象パラメータ (off で無効)。",
    effect: "選んだパラメータが体を動かすほど強まる。off で動きによる増幅なし。",
  },
  "motion.strength": {
    summary: "体の動きが対象パラメータをどれだけ強めるか (param *= 1 + motion*strength)。",
    effect: "上げるほど少しの動きで対象が大きく反応する。0 で動きの影響なし。",
  },

  "outlier.fraction": {
    summary: "外れ値 (暴れる) 粒子として扱う割合 (0..1, ~0.1=10%)。",
    effect: "上げるほど大きく逸脱する粒子が増えカオス感が増す。0 で全粒子が整然と動く。",
  },
  "outlier.boost": {
    summary: "外れ値粒子のオフセット/サイズ/振動に対する倍率 (1=無効)。",
    effect: "上げるほど外れ値粒子が突出して暴れる。1 で通常粒子と同じ。",
  },

  "edges.enabled": {
    summary: "アンカー点間にエッジ (線) を描くサブレンダ層の ON/OFF。",
    effect: "ON で点群に線のワイヤが重なる。OFF で点のみ。",
  },
  "edges.anchorCount": {
    summary: "エッジを張るアンカー点の数 (16..256)。",
    effect: "上げるほど線が密なメッシュ状になる。下げると疎なワイヤになる。",
  },
  "edges.kNeighbors": {
    summary: "各アンカーが接続する近傍点の数 (1..5)。",
    effect: "上げるほど各点から多方向へ線が伸び網が濃くなる。下げると単純な繋がりになる。",
  },
  "edges.alpha": {
    summary: "エッジの明るさ/不透明度 (0..1)。",
    effect: "上げるほど線がはっきり見える。0 で線が消える。",
  },

  "edges.wave.enabled": {
    summary: "エッジを細分化しノイズで波打たせるか (Issue #31)。",
    effect: "ON で各エッジが内部頂点ごとに揺らぎ、生きたワイヤのように見える。OFF で直線。",
  },
  "edges.wave.subdivisions": {
    summary: "1 エッジを何分割するか (2..16)。",
    effect: "上げるほど波形がなめらか・細かくなる。下げるとカクついた折れ線になる。",
  },
  "edges.wave.amplitude": {
    summary: "波の振幅基準 (world m, 0..0.5)。",
    effect: "上げるほどエッジが大きくうねる。0 で実質直線。",
  },
  "edges.wave.audioBoost": {
    summary: "bass による振幅ブースト係数 (0..3)。amp_eff = amplitude * (1 + bass * audioBoost)。",
    effect: "上げると低音が強いとき大きく揺れる。0 で音と無関係な定常揺らぎ。",
  },
  "edges.wave.scale": {
    summary: "ノイズ空間周波数 (0.5..10)。",
    effect: "上げるとエッジ上で細かく波打つ。下げるとゆったり大きくうねる。",
  },
  "edges.wave.speed": {
    summary: "ノイズ流速 (0..3)。波形が時間方向に流れる速さ。",
    effect: "上げるほど波が速く動く。0 で時間停止 (静的な波)。",
  },

  "edges.rewire.enabled": {
    summary: "エッジの結線を一定間隔でランダムに差し替えるか (Issue #31)。",
    effect: "ON でエッジ構成が周期的に変わり、フェードで自然に入れ替わる。OFF で固定。",
  },
  "edges.rewire.interval": {
    summary: "リワイヤの周期 (秒, 0.2..5.0)。0 で実質オフ扱い。",
    effect: "短いほど頻繁にエッジが入れ替わる。長いと変化がゆっくり。",
  },
  "edges.rewire.fraction": {
    summary: "各周期で差し替えるエッジ割合 (0..1)。",
    effect: "上げるほど一度に多くのエッジが入れ替わる。0 で何も入れ替わらない。",
  },
  "edges.rewire.fadeDuration": {
    summary: "古/新エッジのクロスフェード時間 (秒, 0.05..1.0)。",
    effect: "短いとパッと切り替わる。長いと滑らかに溶けるように入れ替わる。",
  },
  "edges.rewire.candidatePool": {
    summary: "新エッジ候補プール幅 (近傍 M 本から k 本選ぶ, kNeighbors..2*kNeighbors 目安)。",
    effect: "小さいほど局所的な再結線で似た見た目を保つ。大きいほど大胆に組み替わる。",
  },

  "twist.enabled": {
    summary: "全粒子位置への軸まわりのねじれ変形の ON/OFF。",
    effect: "ON で形状が軸に沿って捻れる。OFF でねじれなし。",
  },
  "twist.axis": {
    summary: "ねじれの回転軸 (x / y / z)。",
    effect: "選んだ軸を中心に粒子全体が捻れる。軸ごとに捻れる方向が変わる。",
  },
  "twist.strength": {
    summary: "ねじれ量 (rad/m)。軸方向 1m あたりの回転角。",
    effect: "上げるほど強く螺旋状にねじれる。0 でねじれなし。",
  },
  "twist.bassDrive": {
    summary: "低音に応じて加算されるねじれ量。",
    effect: "上げるほど低音でねじれが脈動する。0 で低音によるねじれ変化なし。",
  },
  "twist.phaseSpeed": {
    summary: "ねじれ位相の時間進行速度 (rad/s)。",
    effect: "絶対値を上げるほど螺旋が速く回る。0 でねじれの向きが固定される。",
  },

  "blur.enabled": {
    summary: "最終描画画像へのガウシアンブラー (ポストプロセス) の ON/OFF。",
    effect: "ON で全体が滲みグロー感が出る。OFF でシャープな描画。",
  },
  "blur.strength": {
    summary: "ブラーの強さ (px)。",
    effect: "上げるほど大きく滲む。0 でほぼシャープになる。",
  },
  "blur.iterations": {
    summary: "ブラーの反復回数 (1..6)。",
    effect: "上げるほど滑らかで広範囲な滲みになる (描画負荷も増える)。下げると粗い滲み。",
  },
  "blur.bassDrive": {
    summary: "低音に応じて加算されるブラー強度。",
    effect: "上げるほど低音で画面が大きく滲み脈動する。0 で低音による滲み変化なし。",
  },

  "lattice.resolution": {
    summary: "格子の解像度 NxNxN (8..17)。lattice モード。",
    effect: "上げるほど格子点が細かく密に。下げると粗い格子になる。",
  },
  "lattice.waveSpeed": {
    summary: "波の伝播速度 (m/s)。lattice + image 共有。",
    effect: "上げるほど波が速く広がる。下げるとゆっくり伝わる。",
  },
  "lattice.waveAmplitude": {
    summary: "弾性振動の最大変位 (m)。lattice モード。",
    effect: "上げるほど格子が大きく波打つ。0 で波が出ない。",
  },
  "lattice.waveOscFreq": {
    summary: "振動周波数 (Hz)。lattice + image 共有。",
    effect: "上げるほど細かく速く震える。下げるとゆったり揺れる。",
  },
  "lattice.waveDamping": {
    summary: "減衰時定数 (sec)。lattice + image 共有。",
    effect: "上げるほど波が長く尾を引いて続く。下げると素早く収まる。",
  },
  "lattice.onsetThreshold": {
    summary: "波を起こす onset (低音急増) の検出しきい値。lattice + image 共有。",
    effect: "上げるほど強い打撃でしか波が出ない。下げると敏感に頻発する。",
  },
  "lattice.onsetCooldown": {
    summary: "onset 検出後の不応時間 (sec)。lattice + image 共有。",
    effect: "上げるほど波の発生間隔が空く。下げると連続して波立つ。",
  },

  "image.preset": {
    summary: "ドット化するプリセット画像 (uploaded はアップロード済み画像)。",
    effect: "切り替えると粒子が形作る元画像が変わる。",
  },
  "image.gridW": {
    summary: "画像サンプリングの横グリッド数 (8..120)。",
    effect: "上げるほど横方向のドットが細かくなる。下げると粗いドット絵になる。",
  },
  "image.gridH": {
    summary: "画像サンプリングの縦グリッド数 (8..120)。",
    effect: "上げるほど縦方向のドットが細かくなる。下げると粗いドット絵になる。",
  },
  "image.pushAmount": {
    summary: "中高域 × 輝度に乗じる Z 押し出しゲイン (0..2)。",
    effect: "上げるほど明るい部分が音で手前に飛び出す。0 で平面のまま。",
  },
  "image.noiseAmp": {
    summary: "ノイズ歪みの振幅 (m, 0..0.5)。",
    effect: "上げるほど画像がノイズで揺らいで崩れる。0 でくっきり整列。",
  },
  "image.noiseScale": {
    summary: "ノイズの空間スケール (0.5..8)。",
    effect: "上げるほど歪みが細かくなる。下げると大きくうねる歪みになる。",
  },
  "image.noiseSpeed": {
    summary: "ノイズの時間スケール (0..3)。",
    effect: "上げるほど歪みが速く蠢く。0 で歪みパターンが固定される。",
  },
  "image.waveStrength": {
    summary: "中心波動の振幅 (m, 0..0.5)。速度等は Lattice/Wave 側。",
    effect: "上げるほど中心から広がる波で画像が大きく波打つ。0 で波なし。",
  },
  "image.sizeScale": {
    summary: "粒子サイズ倍率。セル間隔追従サイズに乗算 (0.3..3.0)。",
    effect: "上げるほどドットが大きく重なり塗りつぶし的に。下げると隙間の空いた点描に。",
  },
  "image.particleShape": {
    summary: "粒子の形 (circle=円 / square=矩形)。",
    effect: "square にすると隙間なく繋がり完全なドット絵的に。circle は点描的。",
  },

  "rain.baseSpeed": {
    summary: "雨粒の落下基本速度 (m/s)。鳴っていない帯域でも最低この速度。",
    effect: "上げるほど全体に速く降る。下げるとゆっくり落ちる。",
  },
  "rain.ampGain": {
    summary: "振幅 1 あたりの追加落下速度 (m/s)。",
    effect: "上げるほど音が強い帯域の雨が勢いよく落ちる。0 で音による速度差なし。",
  },
  "rain.count": {
    summary: "雨粒の総数 (mode 再選択で反映される静的値)。",
    effect: "上げるほど雨が密になる (負荷増)。下げると疎らになる。",
  },
  "rain.length": {
    summary: "雫の基準長 (m)。実描画長は速度に比例。",
    effect: "上げるほど雨が長い線状に。下げると短い点状になる。",
  },
  "rain.areaWidth": {
    summary: "描画域の横幅 (m)。FFT bin 全体がこの幅にマップ。",
    effect: "上げるほど雨が横に広く分布する。下げると中央に密集する。",
  },
  "rain.areaHeight": {
    summary: "描画域の高さ (m)。Y はこの高さでリングバッファ。",
    effect: "上げるほど落下距離が長くなる。下げると短い区間で循環する。",
  },
  "rain.binMapping": {
    summary: "周波数 → X のマップ方式 (linear / log)。",
    effect: "log で低域が画面の大半を占め密度感が出る。linear は周波数等間隔。",
  },

  "auto.enabled": {
    summary: "曲解析ベースのパラメータ自動制御の ON/OFF (曲ファイル再生時のみ実効)。",
    effect: "ON で曲のセクションに合わせて自動でパラメータが変化する。OFF で手動値固定。",
  },
  "auto.transitionSec": {
    summary: "セクション境界補間の総幅 (秒)。",
    effect: "上げるほど場面転換が緩やかにクロスフェードする。下げると切り替わりが急になる。",
  },
  "auto.noveltyThreshold": {
    summary: "境界検出の感度 (0..1, percentile ベース)。",
    effect: "上げるほど些細な変化でも境界を検出し場面が頻繁に切り替わる。下げると大きな変化のみ。",
  },
  "auto.minSectionSec": {
    summary: "連続境界をマージする最小セクション間隔 (秒)。",
    effect: "上げるほど短い場面が抑制され切り替えが落ち着く。下げると小刻みに切り替わる。",
  },
  "auto.styleStrength": {
    summary: "スタイルプリセットのブレンド強度 (0..1)。",
    effect: "1 に近いほどプリセットの個性が強く出る。0 で実セクション特徴量のみで地味になる。",
  },
};
