/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'modules-do-not-reach',
      comment: 'Сервіс не імпортує контролер: модулі не лізуть один в одного через HTTP-шар',
      severity: 'error',
      from: { path: '\\.service\\.ts$' },
      to: { path: 'controller\\.(ts|js)$' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
  },
};
