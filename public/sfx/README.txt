guns.wav —— 游戏里的真实枪声（20 声接在一起，位置表在 js/client/gunsamples.js）

来源：The Free Firearm Sound Library（Still North Media）
      由 Ben Jaszczak、Brian Nelson、Kevin Heras、Matthew Nanney 录制
      https://opengameart.org/content/the-free-firearm-sound-library
授权：CC0（公有领域，可以自由使用、修改、再发布）

用的是哪些录音（都是近距离的那一条）：
  AK-47        -> AK-47
  M4A4         -> AR-15
  加利尔 / 法玛斯 -> SKS
  Glock / P250 -> Walther PPQ
  沙漠之鹰      -> 1911（降了一点调）
  MAC-10 / MP9 -> PPSh
  UMP-45       -> Carl Gustav M45（降了一点调）
  Nova         -> Benelli Nova
  AWP          -> Mosin Nagant（降了一点调）
  鸟狙          -> Tikka T3
带消音器的 USP-S、M4A1-S 没有合适的录音，还是程序合成的。

近距离录音的能量集中在开头十几毫秒和 500Hz 以下，响完马上就没声了，单独听很真、放进游戏里却又闷又短。
所以每一声都重新调过：
  1. 音色：把中高频提上来（小喇叭上也够响、够脆），低频压一压；
  2. 尾音：后面拖一段程序合成的回声一样的噪声，越往后越闷；狙击枪拖得最长；
  3. 低频冲击：垫一点点合成的低频（戴耳机时胸口那一下）。
调成什么样是照着 CS 里 AK 连射、AWP 单发的听感定的 —— 用的是从游戏录屏里量出来的指标
（各频段的能量占多少、响完之后每秒落多少分贝），不是录屏里的声音本身。

怎么重新生成：见 tools/make-gun-samples.py（裁剪、降到 32kHz、调音色、加尾音、对齐响度）。

hits.wav —— 三种爆头声（打中头盔、没戴头盔两种；位置表在 js/client/hitsamples.js）

来源：Kenney「Impact Sounds」（https://kenney.nl/assets/impact-sounds）
授权：CC0（公有领域，可以自由使用、修改、再发布）

每一声是十几条真实的撞击录音（金属、铃、铁皮、玻璃、木头、拳击、闷响）各变一点调、按时间叠起来的，
再把音色（各频段的能量占比）和响度的起伏往 CS:GO 那三声上靠 —— 靠的是从游戏录屏里量出来的指标，不是录屏里的声音本身。

怎么重新生成：见 tools/make-hit-samples.py（先把用到的 ogg 解码成 48kHz 单声道的 wav 或 f32）。
