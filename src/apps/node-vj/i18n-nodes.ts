// #254: ノード定義文言の i18n カタログ（#244 UI クローム i18n の第2弾）。
// ノード定義（NodeTypeDef）の description / ポート説明 / param 説明をキー化し、
// { key: { ja, en } } をここに集約する。表示点（tooltip / node-add-panel / getNodeCatalog）は
// i18n.ts の resolveNodeText() で解決する。カタログに無い文字列はそのまま表示される。
// キー命名: node.<Type>.desc / node.<Type>.port.<portId> / node.<Type>.param.<paramId>。
// 複数ノードで共有する定義（audio-feature-logic / audio-signal / effect-bypass /
// video-fade-logic）は node.common.<領域>.<id> を使う。
// 網羅性は i18n-nodes.test.ts が registry 走査で検証する（キー漏れ・訳漏れ・死にキーを検出）。
// 注: ja は既存文言をそのまま移設したもの（表示の後方互換）。
import type { Catalog } from "./i18n";

/** ノード定義文言カタログ。 */
export const NODE_CATALOG = {
  "node.Number.desc": {
    ja: "固定の数値を出力する定数ソース。param value をそのまま出力する。🎲ボタンで min〜max のランダム値に再ロール。",
    en: "Constant number source. Outputs the param value as is. The 🎲 button rerolls it to a random value between min and max.",
  },
  "node.Number.param.min": {
    ja: "🎲ランダム化の下限。",
    en: "Lower bound for 🎲 randomization.",
  },
  "node.Number.param.max": {
    ja: "🎲ランダム化の上限。",
    en: "Upper bound for 🎲 randomization.",
  },
  "node.Time.desc": {
    ja: "経過秒を出力する時間ソース。timeSec × scale を出力する。",
    en: "Time source that outputs elapsed seconds. Outputs timeSec × scale.",
  },
  "node.Time.param.scale": {
    ja: "経過秒に掛ける倍率。大きいほど時間が速く進む（出力 = timeSec × scale）。",
    en: "Multiplier applied to elapsed seconds. Larger values make time run faster (output = timeSec × scale).",
  },
  "node.Pulse.desc": {
    ja: "一定間隔（interval 秒）で trigger を発火し続けるメトロノーム的ジェネレータ。",
    en: "Metronome-like generator that keeps firing a trigger at a fixed interval (every interval seconds).",
  },
  "node.Pulse.port.trigger": {
    ja: "interval ごとに 1 フレーム発火する trigger。",
    en: "Trigger that fires for one frame every interval.",
  },
  "node.Pulse.param.interval": {
    ja: "発火間隔（秒）。",
    en: "Firing interval (seconds).",
  },
  "node.TapSequencer.desc": {
    ja: "録音ボタンを押しているあいだスペースキーの手打ちタイミングを記録し（ループ長＝押していた時間）、離すと記録どおりに trigger をループ発火する。録音中のタップも即時発火。Envelope/Flash 等へ。",
    en: "While the record button is held, records Space-key tap timings (loop length = hold duration); on release, loops trigger firings exactly as recorded. Taps also fire immediately while recording. Feed into Envelope/Flash etc.",
  },
  "node.TapSequencer.port.trigger": {
    ja: "記録した手打ちタイミングで 1 フレーム発火する trigger（末尾でループ）。",
    en: "Trigger that fires for one frame at the recorded tap timings (loops at the end).",
  },
  "node.Automation.desc": {
    ja: "ノードを選択して物理キー 'r' をホールドしているあいだ value の時間軌跡を記録し（離すと確定・可変長）、ループ再生できる loop station 的なノード。再生中は記録値を線形補間して出力、記録中は value をパススルーする。再度 'r' で記録すると前の記録を破棄して新規記録。",
    en: "While the node is selected and physical key 'r' is held, records the value param's trajectory over time (release to finalize; variable length), a loop-station-style recorder. Outputs the interpolated recorded value while playing, and passes value through while recording. Recording again with 'r' discards the previous recording and starts a new one.",
  },
  "node.Automation.port.reset": {
    ja: "立ち上がりで再生位置を先頭へ戻すトリガ。",
    en: "Trigger that returns the playback position to the start on its rising edge.",
  },
  "node.Automation.port.out": {
    ja: "再生中は記録値を補間した値、記録中/未記録時は value をそのまま出力。",
    en: "Interpolated recorded value while playing; outputs value as-is while recording or before any recording exists.",
  },
  "node.Automation.param.value": {
    ja: "記録するソース値。他ノードから接続する、またはドラッグ/クリックで手動操作する（記録中/未記録時はそのままパススルーされる）。",
    en: "Source value to record. Connect from another node, or drag/click to set it manually (passed straight through while recording or before any recording exists).",
  },
  "node.Automation.param.loopMode": {
    ja: "ループ再生モード（once=末尾で停止 / loop=先頭へラップ / pingpong=往復）。",
    en: "Loop playback mode (once = stop at the end / loop = wrap to the start / pingpong = back and forth).",
  },
  "node.Automation.param.speed": {
    ja: "再生速度の倍率。",
    en: "Playback speed multiplier.",
  },
  "node.Automation.param.recordedFrames": {
    ja: "記録済みの (時刻, 値) 列（内部保存用・非表示）。",
    en: "Recorded (time, value) sequence (internal storage, hidden).",
  },
  "node.Automation.param.recordedLoopLenSec": {
    ja: "記録済みのループ長（秒・内部保存用・非表示）。",
    en: "Recorded loop length in seconds (internal storage, hidden).",
  },
  "node.RandomValue.desc": {
    ja: "min〜max のランダム値を出力。trigger の立ち上がり、または interval 秒ごとに再ロールする。",
    en: "Outputs a random value between min and max. Rerolls on a rising trigger edge or every interval seconds.",
  },
  "node.RandomValue.port.trigger": {
    ja: "立ち上がりで値を再ロールする trigger（任意）。",
    en: "Trigger that rerolls the value on its rising edge (optional).",
  },
  "node.RandomValue.port.out": {
    ja: "現在のランダム値。",
    en: "Current random value.",
  },
  "node.RandomValue.param.min": {
    ja: "ランダム値の下限。",
    en: "Lower bound of the random value.",
  },
  "node.RandomValue.param.max": {
    ja: "ランダム値の上限。",
    en: "Upper bound of the random value.",
  },
  "node.RandomValue.param.interval": {
    ja: "自動再ロール間隔（秒）。0 で自動なし（trigger のみ）。",
    en: "Auto-reroll interval (seconds). 0 disables auto reroll (trigger only).",
  },
  "node.CameraInput.desc": {
    ja: "カメラ映像と姿勢推定を入力するノード。映像 texture・骨格 pose を出力する（動き量は PoseFeatures へ）。",
    en: "Inputs camera video and pose estimation. Outputs a video texture and a skeleton pose (use PoseFeatures for motion amount).",
  },
  "node.CameraInput.port.texture": {
    ja: "カメラ映像のテクスチャ（アスペクト比を入口で正規化済み）。",
    en: "Camera video texture (aspect ratio normalized at input).",
  },
  "node.CameraInput.port.pose": {
    ja: "MediaPipe Pose で推定した骨格（poseDetect=off なら空）。",
    en: "Skeleton estimated by MediaPipe Pose (empty when poseDetect=off).",
  },
  "node.CameraInput.param.poseDetect": {
    ja: "姿勢推定の ON/OFF。off なら映像のみ供給し推定コストをゼロにする。",
    en: "Pose estimation ON/OFF. When off, supplies video only with zero estimation cost.",
  },
  "node.CameraInput.param.skeleton": {
    ja: "プレビュー小窓に骨格線を重畳表示するか。",
    en: "Whether to overlay skeleton lines on the preview window.",
  },
  "node.PoseFeatures.desc": {
    ja: "pose（骨格）を制御信号へ変換する。手の高さ・全身の動き量を number で出力（肩幅で正規化済み）。",
    en: "Converts pose (skeleton) into control signals. Outputs hand heights and whole-body motion as numbers (normalized by shoulder width).",
  },
  "node.PoseFeatures.port.pose": {
    ja: "CameraInput の pose 出力をつなぐ。未接続時は全出力 0。",
    en: "Connect the pose output of CameraInput. All outputs are 0 when unconnected.",
  },
  "node.PoseFeatures.port.handHeightL": {
    ja: "左手の高さ（肩中心=0、肩幅×raiseSpan 上げで 1）。不可視時 0。",
    en: "Left hand height (shoulder center = 0; 1 when raised by shoulder width × raiseSpan). 0 when not visible.",
  },
  "node.PoseFeatures.port.handHeightR": {
    ja: "右手の高さ（同上）。",
    en: "Right hand height (same as left).",
  },
  "node.PoseFeatures.port.motion": {
    ja: "全身の動き量（pose 差分から算出・motionScale で正規化）。",
    en: "Whole-body motion amount (computed from pose deltas, normalized by motionScale).",
  },
  "node.PoseFeatures.param.smoothing": {
    ja: "連続出力（手の高さ・motion）の追従係数。1 で即追従、小さいほど滑らか。",
    en: "Smoothing factor for continuous outputs (hand height, motion). 1 = instant follow; smaller = smoother.",
  },
  "node.PoseFeatures.param.raiseSpan": {
    ja: "手の高さが 1 になる「肩幅の倍数」。小さいほど少し上げただけで反応。",
    en: "Multiple of shoulder width at which hand height reaches 1. Smaller = reacts to a slight raise.",
  },
  "node.PoseFeatures.param.motionScale": {
    ja: "生の動き量を 0..1 に正規化する除数（想定する最大の動き）。",
    en: "Divisor that normalizes raw motion to 0..1 (expected maximum motion).",
  },
  "node.PoseFeatures.param.outMin": {
    ja: "出力 Remap の下限（手の高さ・motion を [outMin,outMax] に写す）。",
    en: "Lower bound of the output remap (maps hand height / motion into [outMin, outMax]).",
  },
  "node.PoseFeatures.param.outMax": {
    ja: "出力 Remap の上限。",
    en: "Upper bound of the output remap.",
  },
  "node.VideoFileInput.desc": {
    ja: "動画ファイルをループ再生して映像 texture を出力するノード。audio=on で同一動画の音声から音響特徴量（audio/各バンド/onset）も出力する。",
    en: "Loops a video file and outputs its video texture. With audio=on, also outputs audio features (audio/bands/onset) from the same video's sound.",
  },
  "node.VideoFileInput.port.texture": {
    ja: "動画フレームのテクスチャ（アスペクト比を入口で正規化済み）。",
    en: "Video frame texture (aspect ratio normalized at input).",
  },
  "node.common.audioFeature.signal": {
    ja: "音響特徴量バンドル（解析結果）。visual ノードの signal 入力へ繋ぐ。",
    en: "Audio feature bundle (analysis result). Connect to a visual node's signal input.",
  },
  "node.common.audioFeature.volume": {
    ja: "全体音量（おおむね 0〜1）。",
    en: "Overall volume (roughly 0–1).",
  },
  "node.common.audioFeature.bass": {
    ja: "低域成分の強さ（おおむね 0〜1）。",
    en: "Low-band strength (roughly 0–1).",
  },
  "node.common.audioFeature.mid": {
    ja: "中域成分の強さ（おおむね 0〜1）。",
    en: "Mid-band strength (roughly 0–1).",
  },
  "node.common.audioFeature.treble": {
    ja: "高域成分の強さ（おおむね 0〜1）。",
    en: "High-band strength (roughly 0–1).",
  },
  "node.common.audioFeature.trigger": {
    ja: "ビート（音の立ち上がり）検出時に発火する trigger。",
    en: "Trigger that fires when a beat (audio onset) is detected.",
  },
  "node.common.audioSignal.audio": {
    ja: "ルーティング用の実音声信号。Audio Mix / Audio 出力ノードへ繋ぐと発音/合成できる。",
    en: "Actual audio signal for routing. Connect to Audio Mix / Audio Output nodes to play or mix it.",
  },
  "node.VideoFileInput.param.loop": {
    ja: "ループ再生の ON/OFF。",
    en: "Loop playback ON/OFF.",
  },
  "node.common.video.fade": {
    ja: "映像と音の同時フェード（0=黒＋無音、1=そのまま）。他ノードの number 出力で駆動可能。",
    en: "Simultaneous video+audio fade (0 = black + silence, 1 = unchanged). Can be driven by another node's number output.",
  },
  "node.VideoFileInput.param.extractAudio": {
    ja: "動画音声の抽出 ON/OFF。ON で音響特徴量(signal)と実音声(audio)を出力（発音は Audio 出力ノードへ繋いだとき）。既定 OFF=無音・映像のみ。",
    en: "Video audio extraction ON/OFF. When ON, outputs audio features (signal) and actual audio (audio); it sounds when connected to an Audio Output node. Default OFF = silent, video only.",
  },
  "node.common.audioFeature.onsetThreshold": {
    ja: "onset 発火しきい値。bass の前フレーム差がこの値を超えると発火（小さいほど敏感）。",
    en: "Onset firing threshold. Fires when the frame-to-frame bass delta exceeds this value (smaller = more sensitive).",
  },
  "node.common.audioFeature.onsetCooldown": {
    ja: "onset 発火後の再発火までの最小間隔（秒）。連発を防ぐ。",
    en: "Minimum interval (seconds) before the next onset can fire. Prevents rapid re-firing.",
  },
  "node.VideoFileInput.param.assetId": {
    ja: "割り当てられたアセットの id（アセットライブラリ管理・UI 非表示）。",
    en: "Assigned asset id (managed by the asset library; hidden in UI).",
  },
  "node.MicInput.desc": {
    ja: "マイク音声を入力するノード。audio / 各バンド(volume/bass/mid/treble) / onset(trigger) / signal(実音声信号) を出力する。",
    en: "Microphone input node. Outputs audio / bands (volume/bass/mid/treble) / onset (trigger) / signal (actual audio signal).",
  },
  "node.DisplayInput.desc": {
    ja: "画面共有（getDisplayMedia）の映像 texture と音声特徴量を入力する AV ノック。タブ音声 OFF でも映像は動く。",
    en: "AV node that inputs screen-share (getDisplayMedia) video texture and audio features. Video keeps working even with tab audio OFF.",
  },
  "node.DisplayInput.port.texture": {
    ja: "共有タブ映像のテクスチャ（アスペクト比を入口で正規化）。",
    en: "Shared tab video texture (aspect ratio normalized at input).",
  },
  "node.AudioFileInput.desc": {
    ja: "音声ファイルを再生して入力するノード。audio / 各バンド / onset に加え、楽曲解析した section を出力する。",
    en: "Plays an audio file as input. Outputs audio / bands / onset, plus the current section from music analysis.",
  },
  "node.AudioFileInput.port.section": {
    ja: "再生位置から判定した現在の楽曲セクション番号（0 始まり、未再生は -1）。",
    en: "Current music section number determined from playback position (0-based; -1 before playback).",
  },
  "node.AudioFileInput.param.loop": {
    ja: "ループ再生の ON/OFF。",
    en: "Loop playback ON/OFF.",
  },
  "node.AudioFileInput.param.assetId": {
    ja: "割り当てられたアセットの id（アセットライブラリ管理・UI 非表示）。",
    en: "Assigned asset id (managed by the asset library; hidden in UI).",
  },
  "node.SamplePad.desc": {
    ja: "4×4 のパッドに音声ファイルを割り当て、クリックでワンショット発音する。連続クリックで重ねて鳴り、audio 出力を Audio Mix / Audio 出力へ繋げる。",
    en: "Assign audio files to a 4×4 pad grid and play one-shots by clicking. Repeated clicks layer sounds; connect the audio output to Audio Mix / Audio Output.",
  },
  "node.SamplePad.port.trigger": {
    ja: "いずれかのパッド押下時に1フレーム発火する trigger。",
    en: "Trigger that fires for one frame when any pad is pressed.",
  },
  "node.SamplePad.param.volume": {
    ja: "出力全体の音量（master・0〜1）。",
    en: "Overall output volume (master, 0–1).",
  },
  "node.SamplePad.param.padAssets": {
    ja: "各パッドに割り当てたアセットの id 配列（slot=パッド番号・UI 非表示）。",
    en: "Array of asset ids assigned to pads (slot = pad number; hidden in UI).",
  },
  "node.ImageFileInput.desc": {
    ja: "静止画ファイルを読み込んで texture を出力するノード。PointShape の image モードや任意の texture 入力に繋ぐ。",
    en: "Loads a still image file and outputs a texture. Connect to PointShape's image mode or any texture input.",
  },
  "node.ImageFileInput.port.texture": {
    ja: "読み込んだ画像のテクスチャ（アスペクト比を入口で正規化済み）。",
    en: "Loaded image texture (aspect ratio normalized at input).",
  },
  "node.ImageFileInput.param.assetId": {
    ja: "割り当てられたアセットの id（アセットライブラリ管理・UI 非表示）。",
    en: "Assigned asset id (managed by the asset library; hidden in UI).",
  },
  "node.PointShape.desc": {
    ja: "cube/sphere/lattice の点群を GPU 生成するノード。位置テクスチャを points として出力する。",
    en: "Generates cube/sphere/lattice point clouds on the GPU. Outputs a position texture as points.",
  },
  "node.PointShape.port.signal": {
    ja: "bass でノイズ歪み・bones クラスタ膨張・image の Z 押し出しを増幅するための音響特徴量入力。",
    en: "Audio feature input that amplifies bass-driven noise distortion, bones cluster expansion, and image Z extrusion.",
  },
  "node.PointShape.port.pose": {
    ja: "bones モードで点群を骨格（13関節）に追従させる姿勢入力（任意）。",
    en: "Pose input that makes the point cloud follow the skeleton (13 joints) in bones mode (optional).",
  },
  "node.PointShape.port.in": {
    ja: "image モードでサンプルする画像ソース（ImageFileInput 等。未接続なら image は不可視）。",
    en: "Image source sampled in image mode (ImageFileInput etc.; image mode is invisible when unconnected).",
  },
  "node.PointShape.port.points": {
    ja: "GPU 位置テクスチャ参照（ParticleRender 等の points 入力へ繋ぐ）。image では色も付与。",
    en: "GPU position texture reference (connect to points inputs such as ParticleRender). Colors are also assigned in image mode.",
  },
  "node.PointShape.param.mode": {
    ja: "形状。cube=立方体内に散布 / sphere=球面 / lattice=規則格子 / bones=pose の13関節に追従 / image=画像をグリッドサンプルした色付き点群。",
    en: "Shape. cube = scattered inside a cube / sphere = on a sphere / lattice = regular grid / bones = follows 13 pose joints / image = colored points grid-sampled from an image.",
  },
  "node.PointShape.param.count": {
    ja: "粒子数（lattice は近い N^3、image は近い res^2 に丸める）。",
    en: "Particle count (lattice rounds to the nearest N^3; image to the nearest res^2).",
  },
  "node.PointShape.param.radius": {
    ja: "形状の半径（world m）。bones では関節クラスタの広がり、image では画像平面の高さの半分。",
    en: "Shape radius (world m). Joint cluster spread in bones; half the image plane height in image.",
  },
  "node.PointShape.param.noiseAmount": {
    ja: "simplex noise による歪みの強さ（0=綺麗な形状。bass で増幅される）。",
    en: "Strength of simplex-noise distortion (0 = clean shape; amplified by bass).",
  },
  "node.PointShape.param.noiseScale": {
    ja: "ノイズの空間周波数（大きいほど細かい歪み）。",
    en: "Spatial frequency of the noise (larger = finer distortion).",
  },
  "node.SceneInput.desc": {
    ja: "別のシーンの最終映像 texture・音声 audio・音響特徴量(signal 等)を取り込むノード。シーン選択行で参照先を選ぶ（循環は禁止）。",
    en: "Brings in another scene's final video texture, audio, and audio features (signal etc.). Choose the source in the scene selector row (cycles are forbidden).",
  },
  "node.SceneInput.port.texture": {
    ja: "参照先シーンの最終映像テクスチャ。",
    en: "Final video texture of the referenced scene.",
  },
  "node.SceneInput.param.sceneId": {
    ja: "参照先シーンの id（シーン選択行で設定・UI 非表示）。",
    en: "Referenced scene id (set via the scene selector row; hidden in UI).",
  },
  "node.Multiply.desc": {
    ja: "2 入力 a・b を掛け合わせて出力する。未接続入力は param 値（既定 1）にフォールバック。",
    en: "Multiplies the two inputs a and b. Unconnected inputs fall back to param values (default 1).",
  },
  "node.Add.desc": {
    ja: "2 入力 a・b を足し合わせて出力する。未接続入力は param 値（既定 0）にフォールバック。",
    en: "Adds the two inputs a and b. Unconnected inputs fall back to param values (default 0).",
  },
  "node.Sine.desc": {
    ja: "正弦波 LFO。out = offset + amplitude·sin(2π·freq·t)。t 未接続なら経過秒を使う。",
    en: "Sine LFO. out = offset + amplitude·sin(2π·freq·t). Uses elapsed seconds when t is unconnected.",
  },
  "node.Sine.port.t": {
    ja: "位相に使う時間入力（未接続なら経過秒 timeSec）。",
    en: "Time input for the phase (elapsed seconds timeSec when unconnected).",
  },
  "node.Sine.param.freq": {
    ja: "周波数（Hz, 1 秒あたりの振動回数）。",
    en: "Frequency (Hz, oscillations per second).",
  },
  "node.Sine.param.amplitude": {
    ja: "振幅（出力の振れ幅）。",
    en: "Amplitude (output swing).",
  },
  "node.Sine.param.offset": {
    ja: "出力の中心オフセット。",
    en: "Center offset of the output.",
  },
  "node.Noise.desc": {
    ja: "なめらかな揺らぎを生成する。out = offset + amplitude·noise(seed, t·speed)（-1〜1 ベース）。",
    en: "Generates smooth fluctuation. out = offset + amplitude·noise(seed, t·speed) (base range -1 to 1).",
  },
  "node.Noise.port.t": {
    ja: "ノイズの時間軸に使う入力（未接続なら経過秒 timeSec）。",
    en: "Input used as the noise time axis (elapsed seconds timeSec when unconnected).",
  },
  "node.Noise.param.speed": {
    ja: "揺らぎの速さ（時間の進行倍率）。",
    en: "Speed of the fluctuation (time progression multiplier).",
  },
  "node.Noise.param.seed": {
    ja: "乱数シード（値を変えると別の揺らぎパターンになる）。",
    en: "Random seed (changing it gives a different fluctuation pattern).",
  },
  "node.Noise.param.amplitude": {
    ja: "振幅（出力の振れ幅）。",
    en: "Amplitude (output swing).",
  },
  "node.Noise.param.offset": {
    ja: "出力の中心オフセット。",
    en: "Center offset of the output.",
  },
  "node.Remap.desc": {
    ja: "入力値を [inMin,inMax] から [outMin,outMax] の範囲へ線形に写し替える。",
    en: "Linearly remaps the input from [inMin, inMax] to [outMin, outMax].",
  },
  "node.Remap.param.inMin": {
    ja: "入力レンジの下限。",
    en: "Lower bound of the input range.",
  },
  "node.Remap.param.inMax": {
    ja: "入力レンジの上限。",
    en: "Upper bound of the input range.",
  },
  "node.Remap.param.outMin": {
    ja: "出力レンジの下限。",
    en: "Lower bound of the output range.",
  },
  "node.Remap.param.outMax": {
    ja: "出力レンジの上限。",
    en: "Upper bound of the output range.",
  },
  "node.Remap.param.clamp": {
    ja: "ON で出力を [outMin,outMax] に収める（範囲外をはみ出させない）。",
    en: "When ON, clamps the output into [outMin, outMax] (no overshoot).",
  },
  "node.Smooth.desc": {
    ja: "入力の急変を平滑化する（指数移動平均）。out += (in - out)·factor。",
    en: "Smooths abrupt input changes (exponential moving average). out += (in - out)·factor.",
  },
  "node.Smooth.param.factor": {
    ja: "追従係数。1 で即追従、0 で固定（小さいほど滑らか）。",
    en: "Smoothing factor. 1 = instant follow, 0 = frozen (smaller = smoother).",
  },
  "node.PointTransform.desc": {
    ja: "点群を平行移動・回転する。回転（原点まわり）→平行移動の順に適用し points を出力する。",
    en: "Translates and rotates a point cloud. Applies rotation (about the origin) then translation, and outputs points.",
  },
  "node.PointTransform.port.points": {
    ja: "変換元の GPU 位置テクスチャ参照（未接続は no-op）。",
    en: "Source GPU position texture reference (no-op when unconnected).",
  },
  "node.PointTransform.port.points.out": {
    ja: "変換後の GPU 位置テクスチャ参照。",
    en: "Transformed GPU position texture reference.",
  },
  "node.PointTransform.param.translateX": {
    ja: "X 方向の平行移動（world m）。",
    en: "Translation along the X axis (world m).",
  },
  "node.PointTransform.param.translateY": {
    ja: "Y 方向の平行移動（world m）。",
    en: "Translation along the Y axis (world m).",
  },
  "node.PointTransform.param.translateZ": {
    ja: "Z 方向の平行移動（world m）。",
    en: "Translation along the Z axis (world m).",
  },
  "node.PointTransform.param.rotateX": {
    ja: "X 軸まわりの回転（度）。",
    en: "Rotation about the X axis (degrees).",
  },
  "node.PointTransform.param.rotateY": {
    ja: "Y 軸まわりの回転（度）。",
    en: "Rotation about the Y axis (degrees).",
  },
  "node.PointTransform.param.rotateZ": {
    ja: "Z 軸まわりの回転（度）。",
    en: "Rotation about the Z axis (degrees).",
  },
  "node.Envelope.desc": {
    ja: "trigger 発火で立ち上がり（attack）、その後減衰（release）する AD エンベロープを number 出力する。",
    en: "Outputs an AD envelope as a number: rises on trigger (attack), then decays (release).",
  },
  "node.Envelope.port.trigger": {
    ja: "立ち上がりエッジでエンベロープを再発火させる trigger。",
    en: "Trigger that re-fires the envelope on its rising edge.",
  },
  "node.Envelope.port.out": {
    ja: "0〜1 のエンベロープ値。",
    en: "Envelope value from 0 to 1.",
  },
  "node.Envelope.param.attack": {
    ja: "0→1 まで立ち上がる時間（秒）。0 なら発火直後に 1。",
    en: "Time to rise from 0 to 1 (seconds). 0 jumps to 1 right on firing.",
  },
  "node.Envelope.param.release": {
    ja: "1→0 まで減衰する時間（秒）。",
    en: "Time to decay from 1 to 0 (seconds).",
  },
  "node.FlipFlop.desc": {
    ja: "trigger の発火（立ち上がりエッジ）ごとに出力を 0↔1 で反転するトグル。",
    en: "Toggle that flips its output between 0 and 1 on every trigger firing (rising edge).",
  },
  "node.FlipFlop.port.trigger": {
    ja: "立ち上がりエッジで状態を反転させる trigger。",
    en: "Trigger that flips the state on its rising edge.",
  },
  "node.FlipFlop.port.out": {
    ja: "現在の状態（0 または 1）。",
    en: "Current state (0 or 1).",
  },
  "node.FlipFlop.param.initial": {
    ja: "初期状態（off=0 / on=1）。",
    en: "Initial state (off = 0 / on = 1).",
  },
  "node.TextureSequencer.desc": {
    ja: "複数の texture 入力を trigger の発火ごとに 1 つずつ順送りで出力する（末尾でループ）。onset/拍に合わせて映像ネタを切り替える用途。接続したスロットだけを定義順に巡回する。",
    en: "Steps through multiple texture inputs one at a time on each trigger firing (loops at the end). Use to switch visuals on onsets/beats. Cycles through connected slots only, in definition order.",
  },
  "node.TextureSequencer.port.tex1": {
    ja: "シーケンス入力 1。接続したスロットだけを順番に巡回する。",
    en: "Sequence input 1. Only connected slots are cycled in order.",
  },
  "node.TextureSequencer.port.tex2": {
    ja: "シーケンス入力 2。接続したスロットだけを順番に巡回する。",
    en: "Sequence input 2. Only connected slots are cycled in order.",
  },
  "node.TextureSequencer.port.tex3": {
    ja: "シーケンス入力 3。接続したスロットだけを順番に巡回する。",
    en: "Sequence input 3. Only connected slots are cycled in order.",
  },
  "node.TextureSequencer.port.tex4": {
    ja: "シーケンス入力 4。接続したスロットだけを順番に巡回する。",
    en: "Sequence input 4. Only connected slots are cycled in order.",
  },
  "node.TextureSequencer.port.tex5": {
    ja: "シーケンス入力 5。接続したスロットだけを順番に巡回する。",
    en: "Sequence input 5. Only connected slots are cycled in order.",
  },
  "node.TextureSequencer.port.tex6": {
    ja: "シーケンス入力 6。接続したスロットだけを順番に巡回する。",
    en: "Sequence input 6. Only connected slots are cycled in order.",
  },
  "node.TextureSequencer.port.tex7": {
    ja: "シーケンス入力 7。接続したスロットだけを順番に巡回する。",
    en: "Sequence input 7. Only connected slots are cycled in order.",
  },
  "node.TextureSequencer.port.tex8": {
    ja: "シーケンス入力 8。接続したスロットだけを順番に巡回する。",
    en: "Sequence input 8. Only connected slots are cycled in order.",
  },
  "node.TextureSequencer.port.trigger": {
    ja: "立ち上がりエッジで次の texture へ進める。",
    en: "Advances to the next texture on a rising edge.",
  },
  "node.TextureSequencer.port.reset": {
    ja: "立ち上がりエッジで先頭（最初の接続スロット）へ戻す。",
    en: "Returns to the start (first connected slot) on a rising edge.",
  },
  "node.TextureSequencer.port.texture": {
    ja: "現在選択中の入力 texture（接続なしは無出力）。",
    en: "Currently selected input texture (no output when nothing is connected).",
  },
  "node.TextureSequencer.param.random": {
    ja: "ON で trigger ごとに接続中の texture からランダムに選ぶ（OFF は順送り）。",
    en: "When ON, picks a random connected texture per trigger (OFF = sequential).",
  },
  "node.AudioMix.desc": {
    ja: "ミキサー。複数の実音声(audio)を入力ごとの level で音量調整しながら合成する。合成した audio を出力し、その音響特徴量(signal)も出力する。",
    en: "Mixer. Blends multiple audio signals, adjusting each input's volume with its level. Outputs the mixed audio plus its audio features (signal).",
  },
  "node.AudioMix.port.in1": {
    ja: "合成する音声 1。level1 で音量を調整。",
    en: "Audio input 1 to mix. Adjust its volume with level1.",
  },
  "node.AudioMix.port.in2": {
    ja: "合成する音声 2。level2 で音量を調整。",
    en: "Audio input 2 to mix. Adjust its volume with level2.",
  },
  "node.AudioMix.port.in3": {
    ja: "合成する音声 3。level3 で音量を調整。",
    en: "Audio input 3 to mix. Adjust its volume with level3.",
  },
  "node.AudioMix.port.in4": {
    ja: "合成する音声 4。level4 で音量を調整。",
    en: "Audio input 4 to mix. Adjust its volume with level4.",
  },
  "node.AudioMix.param.level1": {
    ja: "入力 1（in1）の音量（0=ミュート, 1=等倍, 2=増幅）。",
    en: "Volume of input 1 (in1) (0 = mute, 1 = unity, 2 = boost).",
  },
  "node.AudioMix.param.level2": {
    ja: "入力 2（in2）の音量（0=ミュート, 1=等倍, 2=増幅）。",
    en: "Volume of input 2 (in2) (0 = mute, 1 = unity, 2 = boost).",
  },
  "node.AudioMix.param.level3": {
    ja: "入力 3（in3）の音量（0=ミュート, 1=等倍, 2=増幅）。",
    en: "Volume of input 3 (in3) (0 = mute, 1 = unity, 2 = boost).",
  },
  "node.AudioMix.param.level4": {
    ja: "入力 4（in4）の音量（0=ミュート, 1=等倍, 2=増幅）。",
    en: "Volume of input 4 (in4) (0 = mute, 1 = unity, 2 = boost).",
  },
  "node.AudioMix.param.gain": {
    ja: "合成後のマスタゲイン（0〜2）。",
    en: "Master gain after mixing (0–2).",
  },
  "node.AudioDelay.desc": {
    ja: "音声(audio)を delayMs だけ遅らせて出力する。映像の遅れに合わせて音を遅らせ、AudioOutput へ繋ぐと A/V が揃う。",
    en: "Delays the audio by delayMs. Delay the sound to match video latency and connect to AudioOutput to line up A/V.",
  },
  "node.AudioDelay.port.audio": {
    ja: "遅延させる実音声信号。",
    en: "Audio signal to delay.",
  },
  "node.AudioDelay.param.delayMs": {
    ja: "遅延時間（ミリ秒）。映像の遅れに合わせて耳と目で調整する。",
    en: "Delay time (milliseconds). Tune by ear and eye to match the video latency.",
  },
  "node.AudioFilter.desc": {
    ja: "音声フィルタ。audio を lowpass/highpass/bandpass で加工する。frequency を Sine 等の number 出力で振ると音が動く。",
    en: "Audio filter. Processes audio with lowpass/highpass/bandpass. Sweep frequency with a Sine number output to make the sound move.",
  },
  "node.AudioFilter.port.audio": {
    ja: "加工する実音声信号。",
    en: "Audio signal to process.",
  },
  "node.AudioFilter.param.enabled": {
    ja: "エフェクトの有効/無効。off で入力をそのまま出力（パススルー）。",
    en: "Effect enable/disable. When off, passes the input through unchanged.",
  },
  "node.AudioFilter.param.type": {
    ja: "フィルタ種別（lowpass=低域通過, highpass=高域通過, bandpass=帯域通過）。",
    en: "Filter type (lowpass / highpass / bandpass).",
  },
  "node.AudioFilter.param.frequency": {
    ja: "カットオフ/中心周波数（Hz）。聴感は対数的なので低域は細かく・高域は大きく動かすとよい。",
    en: "Cutoff/center frequency (Hz). Hearing is logarithmic: sweep finely in lows and broadly in highs.",
  },
  "node.AudioFilter.param.Q": {
    ja: "レゾナンス（カットオフ付近の尖り）。大きいほどクセの強い音になる。",
    en: "Resonance (peak near the cutoff). Larger = more pronounced character.",
  },
  "node.AudioGain.desc": {
    ja: "音声ゲイン。audio の音量を gain で調整する。Envelope 等の number 出力で駆動するとフェード/ダッキングになる。",
    en: "Audio gain. Adjusts audio volume with gain. Drive it with a number output such as Envelope for fades/ducking.",
  },
  "node.AudioGain.port.audio": {
    ja: "音量調整する実音声信号。",
    en: "Audio signal whose volume is adjusted.",
  },
  "node.AudioGain.param.enabled": {
    ja: "エフェクトの有効/無効。off で入力をそのまま出力（パススルー）。",
    en: "Effect enable/disable. When off, passes the input through unchanged.",
  },
  "node.AudioGain.param.gain": {
    ja: "音量（0=ミュート, 1=等倍, 2=増幅）。",
    en: "Volume (0 = mute, 1 = unity, 2 = boost).",
  },
  "node.AudioReverb.desc": {
    ja: "リバーブ。生成したインパルス応答で audio に残響を付ける。decay で残響の長さ、dry/wet は独立（dry=1 のまま wet を上げると原音の音量を変えずに残響が足せる）。",
    en: "Reverb. Adds reverberation to the audio via a generated impulse response. decay sets the tail length; dry/wet are independent (keep dry=1 and raise wet to add reverb without changing the original level).",
  },
  "node.AudioReverb.port.audio": {
    ja: "残響を付ける実音声信号。",
    en: "Audio signal to add reverb to.",
  },
  "node.AudioReverb.param.enabled": {
    ja: "エフェクトの有効/無効。off で入力をそのまま出力（パススルー）。",
    en: "Effect enable/disable. When off, passes the input through unchanged.",
  },
  "node.AudioReverb.param.decay": {
    ja: "残響の長さ（秒）。変更時にインパルス応答を再生成する。",
    en: "Reverb tail length (seconds). Regenerates the impulse response on change.",
  },
  "node.AudioReverb.param.dry": {
    ja: "原音の音量。1 のままなら原音は変わらない（0 で残響のみ）。",
    en: "Dry (original) level. Unchanged at 1 (0 = reverb only).",
  },
  "node.AudioReverb.param.wet": {
    ja: "付加する残響の量（センド量）。原音とは独立に調整できる。",
    en: "Amount of added reverb (send level). Adjustable independently of the dry signal.",
  },
  "node.TextureGenerator.desc": {
    ja: "入力なしで単色/グラデーション（線形・放射状）の texture を生成するソース。色(RGB)・角度は他ノードから駆動できる。",
    en: "Source that generates a solid-color or gradient (linear/radial) texture with no input. Colors (RGB) and angle can be driven by other nodes.",
  },
  "node.TextureGenerator.port.texture": {
    ja: "生成した単色/グラデーションのテクスチャ。",
    en: "Generated solid/gradient texture.",
  },
  "node.TextureGenerator.param.mode": {
    ja: "solid=単色(color1) / linear=線形グラデ / radial=放射状グラデ。",
    en: "solid = single color (color1) / linear = linear gradient / radial = radial gradient.",
  },
  "node.TextureGenerator.param.r1": {
    ja: "色1（solid の色 / グラデ始点）の R。",
    en: "R of color 1 (solid color / gradient start).",
  },
  "node.TextureGenerator.param.g1": {
    ja: "色1の G。",
    en: "G of color 1.",
  },
  "node.TextureGenerator.param.b1": {
    ja: "色1の B。",
    en: "B of color 1.",
  },
  "node.TextureGenerator.param.r2": {
    ja: "色2（グラデ終点）の R。",
    en: "R of color 2 (gradient end).",
  },
  "node.TextureGenerator.param.g2": {
    ja: "色2の G。",
    en: "G of color 2.",
  },
  "node.TextureGenerator.param.b2": {
    ja: "色2の B。",
    en: "B of color 2.",
  },
  "node.TextureGenerator.param.angle": {
    ja: "線形グラデの角度（度）。",
    en: "Angle of the linear gradient (degrees).",
  },
  "node.PointCloudVisual.desc": {
    ja: "pose と audio から点群を描画する visual。形状モードを切り替え、結果を texture 出力する。",
    en: "Visual that renders a point cloud from pose and audio. Switch shape modes; outputs the result as a texture.",
  },
  "node.PointCloudVisual.port.pose": {
    ja: "bones/image モードで骨格に追従させる姿勢入力。",
    en: "Pose input for following the skeleton in bones/image modes.",
  },
  "node.PointCloudVisual.port.signal": {
    ja: "音響特徴量入力（未接続なら環境の特徴量を使う）。",
    en: "Audio feature input (uses the environment features when unconnected).",
  },
  "node.PointCloudVisual.port.texture": {
    ja: "描画結果のテクスチャ（Screen やエフェクトへ繋ぐ）。",
    en: "Rendered texture (connect to Screen or effects).",
  },
  "node.PointCloudVisual.param.mode": {
    ja: "形状モード。bones=骨格 / cube/sphere/lattice=幾何形状 / image=画像サンプル。",
    en: "Shape mode. bones = skeleton / cube/sphere/lattice = geometry / image = image sampling.",
  },
  "node.PointCloudVisual.param.radius": {
    ja: "形状の半径（world m）。",
    en: "Shape radius (world m).",
  },
  "node.PointCloudVisual.param.bassPulse": {
    ja: "bass に合わせた拍動の強さ。",
    en: "Strength of the bass-synced pulsation.",
  },
  "node.PointCloudVisual.param.polyhedron": {
    ja: "多面体の面数（4/6/8/12）。",
    en: "Number of polyhedron faces (4/6/8/12).",
  },
  "node.PointCloudVisual.param.hueBase": {
    ja: "基準色相（0〜1）。",
    en: "Base hue (0–1).",
  },
  "node.PointCloudVisual.param.hueSpread": {
    ja: "色相の広がり幅（粒子間の色のばらつき）。",
    en: "Hue spread (color variation across particles).",
  },
  "node.PointCloudVisual.param.saturation": {
    ja: "彩度（0〜1）。",
    en: "Saturation (0–1).",
  },
  "node.PointCloudVisual.param.bassExpansion": {
    ja: "bass による粒子の膨張量。",
    en: "Particle expansion amount driven by bass.",
  },
  "node.PointCloudVisual.param.baseSize": {
    ja: "粒子の基本サイズ。",
    en: "Base particle size.",
  },
  "node.PointCloudVisual.param.volumeSize": {
    ja: "音量に応じて粒子サイズを増す量。",
    en: "Additional particle size in response to volume.",
  },
  "node.PointCloudVisual.param.twistStrength": {
    ja: "ねじり変形の強さ（0 でねじらない）。",
    en: "Strength of the twist deformation (0 = no twist).",
  },
  "node.PointCloudVisual.param.twistAxis": {
    ja: "ねじりの軸。",
    en: "Twist axis.",
  },
  "node.PointCloudVisual.param.latticeResolution": {
    ja: "lattice モードの格子解像度（1 辺の分割数）。",
    en: "Lattice grid resolution (divisions per side).",
  },
  "node.PointCloudVisual.param.latticeWaveAmplitude": {
    ja: "lattice モードの波打ち振幅。",
    en: "Wave amplitude in lattice mode.",
  },
  "node.PointCloudVisual.param.gridW": {
    ja: "image モードのサンプリング横解像度。",
    en: "Horizontal sampling resolution in image mode.",
  },
  "node.PointCloudVisual.param.gridH": {
    ja: "image モードのサンプリング縦解像度。",
    en: "Vertical sampling resolution in image mode.",
  },
  "node.ParticleRender.desc": {
    ja: "points（位置テクスチャ）をカメラ向きのビルボード quad で描画する visual。結果を texture 出力する。",
    en: "Visual that renders points (a position texture) as camera-facing billboard quads. Outputs the result as a texture.",
  },
  "node.ParticleRender.port.points": {
    ja: "描画する GPU 位置テクスチャ参照（未接続なら何も描かない）。",
    en: "GPU position texture reference to render (draws nothing when unconnected).",
  },
  "node.ParticleRender.port.signal": {
    ja: "粒子サイズ・明るさを変調する音響特徴量入力（未接続なら環境の特徴量）。",
    en: "Audio feature input that modulates particle size/brightness (environment features when unconnected).",
  },
  "node.ParticleRender.port.texture": {
    ja: "描画結果のテクスチャ。",
    en: "Rendered texture.",
  },
  "node.ParticleRender.param.baseSize": {
    ja: "粒子の基本サイズ。",
    en: "Base particle size.",
  },
  "node.ParticleRender.param.volumeSize": {
    ja: "音量に応じて粒子サイズを増す量。",
    en: "Additional particle size in response to volume.",
  },
  "node.ParticleRender.param.bassExpansion": {
    ja: "bass に応じて粒子サイズを増す量。",
    en: "Additional particle size in response to bass.",
  },
  "node.ParticleRender.param.hueBase": {
    ja: "基準色相（0〜1）。",
    en: "Base hue (0–1).",
  },
  "node.ParticleRender.param.hueSpread": {
    ja: "色相の広がり幅（粒子間の色のばらつき）。",
    en: "Hue spread (color variation across particles).",
  },
  "node.ParticleRender.param.saturation": {
    ja: "彩度（0〜1）。",
    en: "Saturation (0–1).",
  },
  "node.RainVisual.desc": {
    ja: "音に反応する雨のような縦ストリームを描画する visual。結果を texture 出力する。",
    en: "Visual that renders rain-like vertical streams reacting to audio. Outputs the result as a texture.",
  },
  "node.RainVisual.port.signal": {
    ja: "雨の動きを駆動する音響特徴量入力（未接続なら環境の特徴量）。",
    en: "Audio feature input driving the rain motion (environment features when unconnected).",
  },
  "node.RainVisual.port.baseSpeed": {
    ja: "落下速度の入力（未接続なら param 値）。",
    en: "Fall speed input (param value when unconnected).",
  },
  "node.RainVisual.port.count": {
    ja: "粒子数の入力（未接続なら param 値）。",
    en: "Particle count input (param value when unconnected).",
  },
  "node.RainVisual.port.texture": {
    ja: "描画結果のテクスチャ。",
    en: "Rendered texture.",
  },
  "node.RainVisual.param.baseSpeed": {
    ja: "雨粒の基本落下速度。",
    en: "Base fall speed of raindrops.",
  },
  "node.RainVisual.param.count": {
    ja: "雨粒の本数。",
    en: "Number of raindrops.",
  },
  "node.RainVisual.param.ampGain": {
    ja: "音量に対する反応の強さ。",
    en: "Strength of the response to volume.",
  },
  "node.RainVisual.param.length": {
    ja: "雨粒（ストリーク）の長さ。",
    en: "Length of raindrop streaks.",
  },
  "node.RainVisual.param.areaWidth": {
    ja: "雨が降る領域の横幅（world m）。",
    en: "Width of the rain area (world m).",
  },
  "node.RainVisual.param.areaHeight": {
    ja: "雨が降る領域の高さ（world m）。",
    en: "Height of the rain area (world m).",
  },
  "node.Blend.desc": {
    ja: "2 枚のテクスチャ a・b を mode で合成して出力する。未接続入力は黒。",
    en: "Blends the two textures a and b using mode. Unconnected inputs are black.",
  },
  "node.Blend.port.a": {
    ja: "下地（base）テクスチャ。",
    en: "Base texture.",
  },
  "node.Blend.port.b": {
    ja: "重ねる（blend）テクスチャ。",
    en: "Blend (overlay) texture.",
  },
  "node.Blend.port.texture": {
    ja: "合成結果のテクスチャ。",
    en: "Blended texture.",
  },
  "node.Blend.param.mode": {
    ja: "合成モード。normal=上書き / add=加算 / multiply=乗算 / screen=スクリーン。",
    en: "Blend mode. normal = overwrite / add / multiply / screen.",
  },
  "node.Blend.param.mix": {
    ja: "合成の強さ。0 で a そのまま、1 で完全合成（a と合成結果の補間）。",
    en: "Blend strength. 0 = a unchanged, 1 = fully blended (interpolates between a and the blend result).",
  },
  "node.Key.desc": {
    ja: "前景 fg をクロマキー（指定色を透過）/ルマキー（輝度で透過）で抜き、背景 bg と合成する。",
    en: "Keys out the foreground fg via chroma key (a given color becomes transparent) or luma key (by luminance) and composites it over the background bg.",
  },
  "node.Key.port.fg": {
    ja: "前景（キーイング対象）テクスチャ。未接続は黒。",
    en: "Foreground (keyed) texture. Black when unconnected.",
  },
  "node.Key.port.bg": {
    ja: "背景（抜いた所に出る）テクスチャ。未接続は黒。",
    en: "Background texture (shows through keyed areas). Black when unconnected.",
  },
  "node.Key.port.texture": {
    ja: "キーイング合成後のテクスチャ。",
    en: "Composited texture after keying.",
  },
  "node.Key.param.mode": {
    ja: "chroma=指定色を透過（グリーンバック等）/ luma=輝度で透過。",
    en: "chroma = a specified color becomes transparent (green screen etc.) / luma = transparency by luminance.",
  },
  "node.Key.param.keyR": {
    ja: "クロマキー色の R（既定=緑）。",
    en: "R of the chroma key color (default green).",
  },
  "node.Key.param.keyG": {
    ja: "クロマキー色の G。",
    en: "G of the chroma key color.",
  },
  "node.Key.param.keyB": {
    ja: "クロマキー色の B。",
    en: "B of the chroma key color.",
  },
  "node.Key.param.threshold": {
    ja: "透過のしきい値（chroma=キー色との距離 / luma=輝度）。",
    en: "Keying threshold (chroma = distance from the key color / luma = luminance).",
  },
  "node.Key.param.softness": {
    ja: "エッジの柔らかさ（しきい値からの遷移幅）。",
    en: "Edge softness (transition width from the threshold).",
  },
  "node.Key.param.spill": {
    ja: "クロマのスピル抑制（エッジのキー色かぶりを除去）。",
    en: "Chroma spill suppression (removes key-color fringing at edges).",
  },
  "node.Key.param.invert": {
    ja: "透過する側を反転する。",
    en: "Inverts which side becomes transparent.",
  },
  "node.EdgeVisual.desc": {
    ja: "アンカー点どうしを線（エッジ）で結んで描画する visual。結果を texture 出力する。",
    en: "Visual that connects anchor points with lines (edges). Outputs the result as a texture.",
  },
  "node.EdgeVisual.port.pose": {
    ja: "bones モードでアンカー配置に使う姿勢入力。",
    en: "Pose input used for anchor placement in bones mode.",
  },
  "node.EdgeVisual.port.signal": {
    ja: "エッジの揺れ等を駆動する音響特徴量入力（未接続なら環境の特徴量）。",
    en: "Audio feature input driving edge wobble etc. (environment features when unconnected).",
  },
  "node.EdgeVisual.port.texture": {
    ja: "描画結果のテクスチャ。",
    en: "Rendered texture.",
  },
  "node.EdgeVisual.param.mode": {
    ja: "アンカー配置の形状。bones=骨格 / cube=立方体 / sphere=球。",
    en: "Anchor placement shape. bones = skeleton / cube / sphere.",
  },
  "node.EdgeVisual.param.anchorCount": {
    ja: "エッジを張るアンカー点の数。",
    en: "Number of anchor points to connect with edges.",
  },
  "node.EdgeVisual.param.kNeighbors": {
    ja: "各アンカーが近傍何点と線を結ぶか。",
    en: "How many nearest neighbors each anchor connects to.",
  },
  "node.EdgeVisual.param.alpha": {
    ja: "エッジ線の不透明度（0〜1）。",
    en: "Edge line opacity (0–1).",
  },
  "node.EdgeVisual.param.radius": {
    ja: "形状の半径（world m）。",
    en: "Shape radius (world m).",
  },
  "node.GraphVisual.desc": {
    ja: "number 入力の時系列を折れ線グラフ（波形）で描画して texture 出力する。右端が最新・左へ流れる。yMin/yMax で縦、windowSec で横スケール。",
    en: "Plots a number input's time series as a line graph (waveform) and outputs it as a texture. Newest at the right edge, flowing left. yMin/yMax set the vertical scale, windowSec the horizontal.",
  },
  "node.GraphVisual.port.value": {
    ja: "グラフに描く数値の時系列。未接続時は 0。",
    en: "Number time series to plot. 0 when unconnected.",
  },
  "node.GraphVisual.port.texture": {
    ja: "波形を描いたテクスチャ。",
    en: "Texture with the drawn waveform.",
  },
  "node.GraphVisual.param.windowSec": {
    ja: "横スケール（時間窓・秒）。この幅ぶんの履歴を画面幅に表示する。",
    en: "Horizontal scale (time window, seconds). This much history spans the screen width.",
  },
  "node.GraphVisual.param.yMin": {
    ja: "縦スケール下端（画面下端に対応する値）。範囲外はクランプ。",
    en: "Bottom of the vertical scale (value at the bottom edge). Out-of-range values are clamped.",
  },
  "node.GraphVisual.param.yMax": {
    ja: "縦スケール上端（画面上端に対応する値）。範囲外はクランプ。",
    en: "Top of the vertical scale (value at the top edge). Out-of-range values are clamped.",
  },
  "node.GraphVisual.param.lineWidth": {
    ja: "折れ線の太さ（px）。",
    en: "Line thickness (px).",
  },
  "node.GraphVisual.param.r": {
    ja: "線色の R（0..1）。",
    en: "Line color R (0..1).",
  },
  "node.GraphVisual.param.g": {
    ja: "線色の G（0..1）。",
    en: "Line color G (0..1).",
  },
  "node.GraphVisual.param.b": {
    ja: "線色の B（0..1）。",
    en: "Line color B (0..1).",
  },
  "node.GraphVisual.param.bgAlpha": {
    ja: "背景の不透明度（0=透明→下のレイヤが透ける / 1=不透明な黒）。",
    en: "Background opacity (0 = transparent, layers below show through / 1 = opaque black).",
  },
  "node.GraphVisual.param.zeroLine": {
    ja: "中央基準線（値 0 の水平線）。on で表示。",
    en: "Center reference line (horizontal line at 0). Shown when on.",
  },
  "node.Blur.desc": {
    ja: "入力テクスチャにガウスぼかしをかける（水平・垂直の 2 パス）。strength<=0 はパススルー。",
    en: "Applies Gaussian blur to the input texture (horizontal + vertical passes). strength <= 0 passes through.",
  },
  "node.Blur.port.in": {
    ja: "ぼかす元のテクスチャ。",
    en: "Source texture to blur.",
  },
  "node.Blur.port.texture": {
    ja: "ぼかし後のテクスチャ。",
    en: "Blurred texture.",
  },
  "node.common.effect.enabled": {
    ja: "エフェクトの有効/無効。off で入力をそのまま出力（パススルー）。",
    en: "Effect enable/disable. When off, passes the input through unchanged.",
  },
  "node.Blur.param.strength": {
    ja: "ぼかしの強さ（カーネル半径）。0 以下で無効化（コストゼロ）。",
    en: "Blur strength (kernel radius). Disabled at 0 or below (zero cost).",
  },
  "node.Bloom.desc": {
    ja: "明るい部分を抽出してぼかし、元画像へ加算合成して発光（グロー）させるエフェクト。",
    en: "Extracts bright areas, blurs them, and additively composites them back for a glow effect.",
  },
  "node.Bloom.port.in": {
    ja: "発光させる元のテクスチャ。",
    en: "Source texture to make glow.",
  },
  "node.Bloom.port.texture": {
    ja: "グロー適用後のテクスチャ。",
    en: "Texture after the glow.",
  },
  "node.Bloom.param.threshold": {
    ja: "光らせる明るさの下限。低いほど広く光る。",
    en: "Minimum brightness that glows. Lower = wider glow.",
  },
  "node.Bloom.param.intensity": {
    ja: "発光の強さ（加算量）。",
    en: "Glow strength (additive amount).",
  },
  "node.Bloom.param.radius": {
    ja: "滲みの広がり（ぼかし半径）。",
    en: "Glow spread (blur radius).",
  },
  "node.RgbShift.desc": {
    ja: "R/B チャンネルを逆方向にずらす色収差エフェクト。trigger で一瞬大きくずらせる。",
    en: "Chromatic aberration effect that shifts the R/B channels in opposite directions. A trigger can briefly boost the shift.",
  },
  "node.RgbShift.port.in": {
    ja: "ずらす元のテクスチャ。",
    en: "Source texture to shift.",
  },
  "node.RgbShift.port.trigger": {
    ja: "立ち上がりで一瞬ずれ量を増幅する trigger（onset 等）。",
    en: "Trigger that momentarily amplifies the shift on a rising edge (onset etc.).",
  },
  "node.RgbShift.port.texture": {
    ja: "色収差適用後のテクスチャ。",
    en: "Texture after the chromatic aberration.",
  },
  "node.RgbShift.param.amount": {
    ja: "常時のずれ量（UV 単位）。",
    en: "Constant shift amount (UV units).",
  },
  "node.RgbShift.param.angle": {
    ja: "ずらす方向（0〜1 を一周にマップ）。",
    en: "Shift direction (0–1 maps to a full turn).",
  },
  "node.RgbShift.param.triggerAmount": {
    ja: "trigger 発火時に加算するずれ量。",
    en: "Extra shift added when the trigger fires.",
  },
  "node.RgbShift.param.decay": {
    ja: "trigger 後のずれが戻るまでの時間（秒）。",
    en: "Time for the trigger shift to settle back (seconds).",
  },
  "node.Pixelate.desc": {
    ja: "画面をブロック状に粗くするモザイク。posterize で色階調も粗くできる。",
    en: "Mosaic that coarsens the screen into blocks. posterize can also quantize the color levels.",
  },
  "node.Pixelate.port.in": {
    ja: "モザイクをかける元のテクスチャ。",
    en: "Source texture to pixelate.",
  },
  "node.Pixelate.port.texture": {
    ja: "モザイク適用後のテクスチャ。",
    en: "Texture after the mosaic.",
  },
  "node.Pixelate.param.blockSize": {
    ja: "1 ブロックのピクセル数。大きいほど粗い。",
    en: "Pixels per block. Larger = coarser.",
  },
  "node.Pixelate.param.posterize": {
    ja: "色階調の段数。2 以上で量子化、0/1 で無効。",
    en: "Number of color levels. 2 or more quantizes; 0/1 disables.",
  },
  "node.ColorGrade.desc": {
    ja: "色相回転・彩度・明度・コントラストを調整するカラーコレクション。hueShift を Time/Sine で回すと色が巡回する。",
    en: "Color correction for hue rotation, saturation, brightness, and contrast. Rotate hueShift with Time/Sine to cycle colors.",
  },
  "node.ColorGrade.port.in": {
    ja: "色調整する元のテクスチャ。",
    en: "Source texture to grade.",
  },
  "node.ColorGrade.port.texture": {
    ja: "色調整後のテクスチャ。",
    en: "Color-graded texture.",
  },
  "node.ColorGrade.param.hueShift": {
    ja: "色相の回転量（0〜1 で一周）。",
    en: "Hue rotation amount (0–1 = full turn).",
  },
  "node.ColorGrade.param.saturation": {
    ja: "彩度。0 でモノクロ、1 で原色維持、>1 で強調。",
    en: "Saturation. 0 = monochrome, 1 = original, >1 = boosted.",
  },
  "node.ColorGrade.param.brightness": {
    ja: "明るさの倍率。",
    en: "Brightness multiplier.",
  },
  "node.ColorGrade.param.contrast": {
    ja: "コントラスト（中間グレー基準）。",
    en: "Contrast (about mid gray).",
  },
  "node.Crt.desc": {
    ja: "走査線・色にじみ・ノイズ・ビネットを乗せてレトロな CRT/VHS 質感にするエフェクト。",
    en: "Adds scanlines, color bleed, noise, and vignette for a retro CRT/VHS look.",
  },
  "node.Crt.port.in": {
    ja: "質感を乗せる元のテクスチャ。",
    en: "Source texture to stylize.",
  },
  "node.Crt.port.texture": {
    ja: "CRT/VHS 質感適用後のテクスチャ。",
    en: "Texture after the CRT/VHS treatment.",
  },
  "node.Crt.param.scanline": {
    ja: "走査線の濃さ。",
    en: "Scanline darkness.",
  },
  "node.Crt.param.scanlineCount": {
    ja: "走査線の本数（画面全体の縞の数）。多いほど細かい。",
    en: "Number of scanlines (stripes across the screen). More = finer.",
  },
  "node.Crt.param.colorBleed": {
    ja: "色にじみ（R/B の横ずれ量）。",
    en: "Color bleed (horizontal R/B offset).",
  },
  "node.Crt.param.noise": {
    ja: "ノイズ（ザラつき）の量。",
    en: "Amount of noise (grain).",
  },
  "node.Crt.param.vignette": {
    ja: "周辺減光（ビネット）の強さ。",
    en: "Vignette (edge darkening) strength.",
  },
  "node.Kaleidoscope.desc": {
    ja: "入力テクスチャを放射状に鏡像反復させ、万華鏡パターンを作るエフェクト。",
    en: "Mirrors the input texture radially to create a kaleidoscope pattern.",
  },
  "node.Kaleidoscope.port.in": {
    ja: "万華鏡化する元のテクスチャ。",
    en: "Source texture to kaleidoscope.",
  },
  "node.Kaleidoscope.port.texture": {
    ja: "エフェクト適用後のテクスチャ。",
    en: "Texture after the effect.",
  },
  "node.Kaleidoscope.param.segments": {
    ja: "分割数（鏡像セクターの数）。",
    en: "Number of mirror sectors.",
  },
  "node.Kaleidoscope.param.rotation": {
    ja: "パターンの回転（ラジアン）。",
    en: "Pattern rotation (radians).",
  },
  "node.Kaleidoscope.param.centerX": {
    ja: "中心の X オフセット（画面中央が 0）。",
    en: "Center X offset (0 = screen center).",
  },
  "node.Kaleidoscope.param.centerY": {
    ja: "中心の Y オフセット（画面中央が 0）。",
    en: "Center Y offset (0 = screen center).",
  },
  "node.Kaleidoscope.param.mix": {
    ja: "効果の強さ。0 で元画像、1 で万華鏡（補間）。",
    en: "Effect strength. 0 = original, 1 = full kaleidoscope (interpolated).",
  },
  "node.Fractal.desc": {
    ja: "入力テクスチャを縮小・回転して再帰的に重ね、フラクタル状の入れ子模様を作るエフェクト。",
    en: "Recursively overlays shrunken, rotated copies of the input texture, creating fractal-like nesting.",
  },
  "node.Fractal.port.in": {
    ja: "再帰コピーする元のテクスチャ。",
    en: "Source texture to copy recursively.",
  },
  "node.Fractal.port.texture": {
    ja: "エフェクト適用後のテクスチャ。",
    en: "Texture after the effect.",
  },
  "node.Fractal.param.iterations": {
    ja: "再帰の重ね回数。",
    en: "Number of recursive layers.",
  },
  "node.Fractal.param.scale": {
    ja: "1 段ごとの縮小率（小さいほど急に縮む）。",
    en: "Shrink factor per layer (smaller = shrinks faster).",
  },
  "node.Fractal.param.rotation": {
    ja: "1 段ごとの回転量（ラジアン）。",
    en: "Rotation per layer (radians).",
  },
  "node.Fractal.param.fade": {
    ja: "深い段ほど暗くするフェード量。",
    en: "Fade amount darkening deeper layers.",
  },
  "node.Fractal.param.centerX": {
    ja: "縮小中心の X オフセット（画面中央が 0）。",
    en: "Shrink center X offset (0 = screen center).",
  },
  "node.Fractal.param.centerY": {
    ja: "縮小中心の Y オフセット（画面中央が 0）。",
    en: "Shrink center Y offset (0 = screen center).",
  },
  "node.Fractal.param.mix": {
    ja: "効果の強さ。0 で元画像、1 でフラクタル（補間）。",
    en: "Effect strength. 0 = original, 1 = full fractal (interpolated).",
  },
  "node.Distort.desc": {
    ja: "入力テクスチャの UV を変形する歪みエフェクト。fisheye(魚眼/逆歪み)・twist(ねじれ)・wave(波)。",
    en: "Distortion effect that warps the input texture's UVs: fisheye (fisheye/inverse), twist, wave.",
  },
  "node.Distort.port.in": {
    ja: "歪ませる元のテクスチャ。",
    en: "Source texture to distort.",
  },
  "node.Distort.port.texture": {
    ja: "歪み適用後のテクスチャ。",
    en: "Texture after the distortion.",
  },
  "node.Distort.param.mode": {
    ja: "歪みの種類。fisheye=魚眼(amount>0)/逆歪み(amount<0) / twist=ねじれ / wave=波。",
    en: "Distortion type. fisheye = fisheye (amount>0) / inverse (amount<0) / twist / wave.",
  },
  "node.Distort.param.amount": {
    ja: "歪み量。fisheye は正=魚眼/負=逆歪み。",
    en: "Distortion amount. For fisheye, positive = fisheye, negative = inverse.",
  },
  "node.Distort.param.centerX": {
    ja: "中心の X オフセット（画面中央が 0）。",
    en: "Center X offset (0 = screen center).",
  },
  "node.Distort.param.centerY": {
    ja: "中心の Y オフセット（画面中央が 0）。",
    en: "Center Y offset (0 = screen center).",
  },
  "node.Distort.param.radius": {
    ja: "効果の半径（fisheye/twist の及ぶ範囲 / wave の波長）。",
    en: "Effect radius (reach of fisheye/twist; wavelength for wave).",
  },
  "node.Distort.param.mix": {
    ja: "効果の強さ。0 で元画像、1 で歪み（補間）。",
    en: "Effect strength. 0 = original, 1 = fully distorted (interpolated).",
  },
  "node.Feedback.desc": {
    ja: "前フレームの出力を減衰・オフセット・スケール・回転して現フレームに重ねる。残像/無限トンネル系。",
    en: "Overlays the previous frame onto the current one with decay, offset, scale, and rotation. For trails / infinite tunnels.",
  },
  "node.Feedback.port.in": {
    ja: "現フレームの入力テクスチャ。",
    en: "Current frame input texture.",
  },
  "node.Feedback.port.texture": {
    ja: "フィードバック合成後のテクスチャ。",
    en: "Texture after the feedback compositing.",
  },
  "node.Feedback.param.decay": {
    ja: "前フレームの残存度（1 に近いほど長く残る）。",
    en: "Persistence of the previous frame (closer to 1 = longer trails).",
  },
  "node.Feedback.param.offsetX": {
    ja: "前フレームの X 方向オフセット（流れる方向）。",
    en: "Previous frame X offset (drift direction).",
  },
  "node.Feedback.param.offsetY": {
    ja: "前フレームの Y 方向オフセット。",
    en: "Previous frame Y offset.",
  },
  "node.Feedback.param.scale": {
    ja: "前フレームの拡大率（>1 で無限トンネル、<1 で収束）。",
    en: "Previous frame scale (>1 = infinite tunnel, <1 = convergence).",
  },
  "node.Feedback.param.rotate": {
    ja: "前フレームの回転（度/フレーム）。スパイラル残像。",
    en: "Previous frame rotation (degrees/frame). Spiral trails.",
  },
  "node.Flash.desc": {
    ja: "trigger 発火で一瞬光るフラッシュを下地 texture に加算合成するエフェクト。",
    en: "Additively composites a momentary flash onto the base texture when a trigger fires.",
  },
  "node.Flash.port.trigger": {
    ja: "立ち上がりエッジでフラッシュを発火させる trigger。",
    en: "Trigger that fires the flash on a rising edge.",
  },
  "node.Flash.port.in": {
    ja: "下地のテクスチャ（未接続なら黒）。",
    en: "Base texture (black when unconnected).",
  },
  "node.Flash.port.texture": {
    ja: "フラッシュを加算合成したテクスチャ。",
    en: "Texture with the flash added.",
  },
  "node.Flash.param.release": {
    ja: "発火から消えるまでの減衰時間（秒）。",
    en: "Decay time from firing to fade-out (seconds).",
  },
  "node.Flash.param.hue": {
    ja: "フラッシュ色の色相（0〜1）。",
    en: "Flash color hue (0–1).",
  },
  "node.Flash.param.saturation": {
    ja: "フラッシュ色の彩度。0 で白、1 で鮮やかな原色。",
    en: "Flash color saturation. 0 = white, 1 = vivid pure color.",
  },
  "node.TextureTransform.desc": {
    ja: "入力テクスチャを 2D 変換（平行移動/拡大縮小/回転/反転）するエフェクト。はみ出しは wrap で処理。",
    en: "2D-transforms the input texture (translate/scale/rotate/flip). Out-of-bounds areas are handled by wrap.",
  },
  "node.TextureTransform.port.in": {
    ja: "変換する元のテクスチャ。",
    en: "Source texture to transform.",
  },
  "node.TextureTransform.port.texture": {
    ja: "変換後のテクスチャ。",
    en: "Transformed texture.",
  },
  "node.TextureTransform.param.offsetX": {
    ja: "横方向の移動（UV 単位、+で右へ）。",
    en: "Horizontal shift (UV units, + = right).",
  },
  "node.TextureTransform.param.offsetY": {
    ja: "縦方向の移動（UV 単位、+で下へ）。",
    en: "Vertical shift (UV units, + = down).",
  },
  "node.TextureTransform.param.scaleX": {
    ja: "横方向の拡大率（>1 でズームイン）。",
    en: "Horizontal scale factor (>1 zooms in).",
  },
  "node.TextureTransform.param.scaleY": {
    ja: "縦方向の拡大率（>1 でズームイン）。",
    en: "Vertical scale factor (>1 zooms in).",
  },
  "node.TextureTransform.param.rotation": {
    ja: "中心まわりの回転（ラジアン）。",
    en: "Rotation about the center (radians).",
  },
  "node.TextureTransform.param.flipX": {
    ja: "左右反転。",
    en: "Horizontal flip.",
  },
  "node.TextureTransform.param.flipY": {
    ja: "上下反転。",
    en: "Vertical flip.",
  },
  "node.TextureTransform.param.wrap": {
    ja: "はみ出し時の処理（none=描画しない[透明] / repeat=タイル / mirror=鏡像 / clamp=端を引き伸ばし）。",
    en: "Out-of-bounds handling (none = not drawn [transparent] / repeat = tile / mirror = mirrored / clamp = stretch edges).",
  },
  "node.AudioOutput.desc": {
    ja: "音の出口（audio sink）。signal を繋ぐとスピーカーから鳴る。繋がれた音だけが発音される（visual の Screen と同じ思想）。",
    en: "Audio sink (the sound outlet). Connect a signal to play it through the speakers. Only connected sounds are audible (same philosophy as Screen for visuals).",
  },
  "node.AudioOutput.port.audio": {
    ja: "発音する実音声信号。Mic/AudioFile/Video/Mix の audio を繋ぐ。",
    en: "Audio signal to play. Connect the audio output of Mic/AudioFile/Video/Mix.",
  },
  "node.AudioOutput.param.volume": {
    ja: "出力音量（0〜1）。",
    en: "Output volume (0–1).",
  },
  "node.AudioOutput.param.mute": {
    ja: "ミュート。on で無音（volume を無視）。",
    en: "Mute. When on, silences output (ignores volume).",
  },
  "node.Screen.desc": {
    ja: "入力 texture を最終出力（画面）に表示する終端ノード。グラフの出口に置く。",
    en: "Terminal node that shows the input texture on the final output (screen). Place at the end of the graph.",
  },
  "node.Screen.port.texture": {
    ja: "画面に表示するテクスチャ。",
    en: "Texture to display on screen.",
  },
} as const satisfies Catalog;

/** ノード文言カタログのキー型。 */
export type NodeMsgKey = keyof typeof NODE_CATALOG;
