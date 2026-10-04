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

近距离录音的能量都挤在最前面十几毫秒，单独听很真、放进游戏里却显得单薄，所以每一声下面又垫了两层
自己合成的声音：一层低频冲击（200Hz 以下）和一层闷响（200~900Hz），垫多少按枪的大小来定。

怎么重新生成：见 tools/make-gun-samples.py（裁剪、降到 32kHz、垫低频、对齐响度）。
