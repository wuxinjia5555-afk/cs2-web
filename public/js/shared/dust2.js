// 沙二（Dust II 布局）：按俯视平面图逐格转换而来，1 格 = 1 米
// 编码：# = 墙；小写字母 = 地面高度级（a=0, b=1 … 每级 0.4 米）；大写字母 = 箱子等障碍物（字母表示顶部高度级）
// 每行做了行程压缩：字符后面的数字是重复次数
export const DUST2_ROWS = [
  '#114', '#114', '#8f5gh#99', '#8f5MN#99', '#8f5LM#73f15#11', '#8f7#73f15#11', '#8f7#73f15#11', '#8f7#73f15#11', '#8f7#73f15#11',
  '#8f2Lf11H2f2#62f15#11', '#8f2If11ef3e#61f12e3#11', '#8f9Lf4Ke4fg#40f5ef2Jg2fe4f9Ke8#11', '#8f11efeKe4fg#40f8L3Ife3f9Ke9#10',
  '#8f11efe6Li2Le3fI#33f14ef10Ke9#10', '#8f8Lf4e6ML3d3GJ#33f25Ke9#10', '#8f13e4HKMigKd3GJ#33f17I7fLe9#10',
  '#8f14e4Ifg#ed8cb8ejkjhg#15e2f15Ighgf2hgIe9#10', '#8df12Lf7#d9cb7EMPk2jhg#8f2GF2d3ef14ghNKhghJ2e9#10',
  '#8d3f12e3f2e#d4c2d2c2b7H2MN2MJd#8fdcb2cd3e2f11gh2NJf2L2Ie9#10', '#8d2Gde2f8eH4e2#d4c3dcb9HghKJ2d#8Gc2b2c2d3e2f11h2Ngf4Ie9#10',
  '#7d7efI2fed6efe#d3c6b14c2#8Gcb4c2d3e2I6H4hKNg5Le2de3d3#10', '#7d8eK2d10G#d3c6b16#8fcb4c2d3eHef2IHecb3egJg5Led8#10',
  '#7d8GJ2d10J#d3c6b16#7ILFb4c2d3eHef2Icb6cLf5Jd9#10', '#7d26c6b18GJe2fL2Ib4c2d4He2dEb7cFIf3Jd10#10',
  '#7d26c6b18H2EbdK2Fb4c2d4Kedb8c4d18#6', '#7d26c6b18H2b3cIb5c2d4Jdb7c6d18#6', '#7d27c5b24Ec2b2c2d3edJa3b4c7d18#6',
  '#7d27c5b24Hc5d4edJa3b4c7d18#6', '#7d26J2Ic3b24EIF3cd2Ge3Jb7c6d15Jd3#6', '#7d22#d3J2Kc#3b4#3b17c3d#e4feIcbab4c6d15J2d2#6',
  '#7d21#19b12H2b3c#4fe2f2e2#9c4d15K2fd#6', '#7d21#19b12H2b2#6f5K#18d11GJed#6', '#7d21#19b8#14f7#18d11Jd2#6',
  '#7d15GJd4#19b8#14f7#18d14#6', '#7d9Gd4J3d4#19b8#13f8#18d14#6', '#7d8HJ2d2GJd5#20b8#13f8#18d14#6',
  '#8d5e3Ked8#21b9#12d2f4d2#17d13#8', '#11e2f#5d6#22b9#12d7#18d11#10', '#11f3#5d2J2d#23b8#14cd6#17d11#10',
  '#11f3#5d3G#24b8#14c2d5#17d10#11', '#11f3#5d4#26b6#14cd6#17d10#11', '#11f3#35b6#4d5#5d7#17d10#11',
  '#11f3#35b6#4d6#3d8#17d10#11', '#11f3#17cIfIHb18cd21#18d9#11', '#11f3#17bH4b17EHed20#18d9#11',
  '#10f5#16b22HKHd19#19d9#11', '#7m2lLf10#10b10HEb10HKHd17J2#19d9#11', '#7mOPLf9e#10b10H2b12d18ef#19d9#11',
  '#7jPL2f10#11b8cIFb12d6#33d9#11', '#7f23LKcb3a#12b7d4#34d9#11', '#7f23K2dcb2a#12b7d3#34d10#11',
  '#7f23e2dc2ba#12b7d3#18d3io4lJd16#11', '#7f23e2d2c2b#12c3b3cd3#16d5KOo2PjJd16#11', '#7f22e3d2c2#13c4bc2d3#16d5JKOQPd18#11',
  '#7f22e3d3c#13c7d3#16d7e2d19#11', '#7ef21e2d3#15c7d3#16d31J#7', '#15f9#25c7d3#16d31Gd#6', '#16ef6#26c7d3#16d33#6',
  '#19f3#27c6d4#16d33#6', '#19f3#27cd3cd5#16d33#6', '#19f3#27d10#16d33#6', '#19f3#27d10#16d8Gd24#6',
  '#19f3#27d10#17d5#4d10c5d8#6', '#18f5#23gLJd10#16d6f#4d8c9d5#6', '#14f13#19fJ2d10#16d4JKh#4d7c10d5#6',
  '#14f13e#18eGd11#16d4JKg#4d7c10d5#6', '#10de5f10e4#16d13#16d5Jg#4d7c9d4f2#6', '#10d3e3Hef5e4d3#16d10J2d#16d7#4d7c3b5cd2f4#6',
  '#10d20#14d16#15d7#4d7c2b7d2f4#6', '#10d20#14d30#d7#4d7cb8d2f4#6', '#10d20#14d38#4d7cb8d2f4#6', '#10d20#14d38#4d7cb8d2f4#6',
  '#10d21#13d38#4d7cb8d2ef3#6', '#10d21#13d38#4d7cb9d2ef2#6', '#10d21#14d30#d5#5d7cb9d2ef#7', '#10d21#14Gd8#11d17#4d7cb9#11',
  '#10d21#14Gd7#12d17#4d7cb9#11', '#10d21#18d4#12d17#12b8#12', '#10d21#18d4#12d17#32', '#11d20#18d4#12d17#32',
  '#11d16JGd2#18d4#12G2d11Gd3#32', '#11d15Jd#21d4#12fJd11J2d2#32', '#11d15G#22d4#12gLGd10K2fd#32', '#11d15f#22eJd2#12fKd11J2fd#32',
  '#10d8Ed5fg2#22fKed#12fJGd11JGd#32', '#10d7JKOJM2gh3#7h3g#11fJd2#12d14Gd2#32', '#10d5e2KO2LNh6#5hKh4#10G2d2#12d17#32',
  '#10e7i4h8#4h6#10d4#12d17#32', '#10e7hLOh19#10d4#12d17#32', '#10e7Jh21#10d4#12d17#32', '#10e6fIh21#10d4#12d16J#32',
  '#10ef3ef2Lh21#10d5#11d8#2d6J#32', '#10f7Lh21#10d6#9d8#42', '#10f7Lh19gh#10c3d20#42', '#9f4g3fMh21#10c6d17#42',
  '#8g9Jh21#10c5d18#42', '#7g10Kh21#10ec4d18#42', '#6h27Kh15f5e5d12Jd2#40', '#6h32KNh13I2e5d14#40', '#6h28ih19Ife5d13#40',
  '#6h49fe5d13#40', '#6h49fe5d13#40', '#6h49fe5d13#40', '#6h28ih20fe5d13#40', '#6h27i2h20fe5d13#40', '#6h28ih19Ife5d13#40',
  '#6h27K3h2K10h5I2fe5d13#40', '#6h33i9h4f3e6d7#46', '#16h33gf4e7d6#47', '#54e6d7#47', '#54e6d7#47', '#54e6d7#47', '#114', '#114',
];

export function decodeRows(rows) {
  return rows.map((r) => {
    let out = '';
    for (const m of r.matchAll(/([#a-zA-Z])(\d*)/g)) out += m[1].repeat(m[2] ? +m[2] : 1);
    return out;
  });
}
