import shutil, os

M = '/var/minis/mounts/surge-icloud'
W = '/var/minis/workspace/qimao-novel-adblock'

# 1) 备份主配置
shutil.copy2(f'{M}/Winson.conf', f'{W}/Winson.conf.bak')
print('[1] 已备份 Winson.conf')

# 2) 移走本地模块与本地脚本（保留到 workspace，供以后回退）
os.makedirs(f'{W}/local-import-backup', exist_ok=True)
for rel, keep in [('七猫小说去广告.sgmodule', '七猫小说去广告.local.sgmodule'),
                  ('Modules/qimao.js', 'qimao.js')]:
    src = f'{M}/{rel}'
    if os.path.exists(src):
        shutil.move(src, f'{W}/local-import-backup/{keep}')
        print(f'[2] 已移走 {rel}')

# 3) Winson.conf 顶部插入 [Module] section（GitHub URL 安装）
p = f'{M}/Winson.conf'
s = open(p, encoding='utf-8').read()
if '[Module]' in s:
    print('[3] [Module] section 已存在，跳过插入')
else:
    url = 'https://raw.githubusercontent.com/zhiaon/qimao-novel-adblock/main/%E4%B8%83%E7%8C%AB%E5%B0%8F%E8%AF%B4%E5%8E%BB%E5%B9%BF%E5%91%8A.sgmodule'
    block = ('[Module]\n'
             '# 七猫小说去广告（从 GitHub 安装，仓库为唯一来源）\n'
             f'七猫小说去广告 = {url}\n\n')
    open(p, 'w', encoding='utf-8').write(block + s)
    print('[3] 已在 Winson.conf 顶部插入 [Module] section')

print()
print('===== Winson.conf 前 12 行 =====')
print('\n'.join(open(p, encoding='utf-8').read().split('\n')[:12]))
print()
print('===== iCloud 目录现状 =====')
for name in sorted(os.listdir(M)):
    print(' -', name)
