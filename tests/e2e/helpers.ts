import type { ElectronApplication } from '@playwright/test';
export async function menuAction(app: ElectronApplication, label: string) {
  await app.evaluate(({ Menu }, label) => {
    const find = (items: any[]): any => {
      for (const item of items) {
        if (item.label === label) return item;
        if (item.submenu) {
          const result = find(item.submenu.items);
          if (result) return result;
        }
      }
    };
    const item = find(Menu.getApplicationMenu()!.items);
    if (!item) throw new Error(`Menu not found: ${label}`);
    item.click();
  }, label);
}
