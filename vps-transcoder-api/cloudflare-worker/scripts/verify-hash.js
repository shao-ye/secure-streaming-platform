// 快速验证哈希值对应的密码
import crypto from 'crypto';

const targetHash = 'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3';
const salt = 'randomsalt123';

// 测试常见密码
const testPasswords = [
  'secret',
  'hello',
  'admin',
  'password',
  '123456',
  'admin123',
  'test'
];

console.log('目标哈希值:', targetHash);
console.log('盐值:', salt);
console.log('\n测试不同密码的哈希值:');

for (const password of testPasswords) {
  // 测试 password + salt
  const hash1 = crypto.createHash('sha256').update(password + salt).digest('hex');
  console.log(`${password} + salt: ${hash1} ${hash1 === targetHash ? '✅ MATCH!' : ''}`);

  // 测试 salt + password
  const hash2 = crypto.createHash('sha256').update(salt + password).digest('hex');
  console.log(`salt + ${password}: ${hash2} ${hash2 === targetHash ? '✅ MATCH!' : ''}`);

  // 测试只有密码
  const hash3 = crypto.createHash('sha256').update(password).digest('hex');
  console.log(`${password} only: ${hash3} ${hash3 === targetHash ? '✅ MATCH!' : ''}`);

  console.log('---');
}
