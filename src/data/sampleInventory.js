<<<<<<< HEAD
// Fallback / sample inventory when no Excel is loaded. Matches Eng-Name, Qty, Price.
export const sampleItems = [
  { id: '1', engName: 'Arduino Nano Board', qty: 12, price: 4.5, value: 54 },
  { id: '2', engName: 'USB-C Cable 1m', qty: 25, price: 2.2, value: 55 },
  { id: '3', engName: 'Resistor Kit 500pcs', qty: 8, price: 9.99, value: 79.92 },
  { id: '4', engName: 'LED 5mm Assorted Box', qty: 6, price: 6.5, value: 39 },
  { id: '5', engName: 'Jumper Wires M-M 40pcs', qty: 15, price: 3.2, value: 48 },
  { id: '6', engName: 'Breadboard 830pts', qty: 10, price: 5.5, value: 55 },
  { id: '7', engName: 'Micro Servo SG90', qty: 7, price: 3.8, value: 26.6 },
  { id: '8', engName: 'Plastic Storage Box Small', qty: 20, price: 1.5, value: 30 },
  { id: '9', engName: 'ESP32 DevKit', qty: 5, price: 8.0, value: 40 },
  { id: '10', engName: 'Capacitor Kit  assorted', qty: 4, price: 7.5, value: 30 },
];

export const sampleTotals = {
  totalValue: sampleItems.reduce((s, i) => s + i.value, 0),
  totalQty: sampleItems.reduce((s, i) => s + i.qty, 0),
};
=======
// Fallback / sample inventory when no Excel is loaded. Matches Eng-Name, Qty, Price.
export const sampleItems = [
  { id: '1', engName: 'Arduino Nano Board', qty: 12, price: 4.5, value: 54 },
  { id: '2', engName: 'USB-C Cable 1m', qty: 25, price: 2.2, value: 55 },
  { id: '3', engName: 'Resistor Kit 500pcs', qty: 8, price: 9.99, value: 79.92 },
  { id: '4', engName: 'LED 5mm Assorted Box', qty: 6, price: 6.5, value: 39 },
  { id: '5', engName: 'Jumper Wires M-M 40pcs', qty: 15, price: 3.2, value: 48 },
  { id: '6', engName: 'Breadboard 830pts', qty: 10, price: 5.5, value: 55 },
  { id: '7', engName: 'Micro Servo SG90', qty: 7, price: 3.8, value: 26.6 },
  { id: '8', engName: 'Plastic Storage Box Small', qty: 20, price: 1.5, value: 30 },
  { id: '9', engName: 'ESP32 DevKit', qty: 5, price: 8.0, value: 40 },
  { id: '10', engName: 'Capacitor Kit  assorted', qty: 4, price: 7.5, value: 30 },
];

export const sampleTotals = {
  totalValue: sampleItems.reduce((s, i) => s + i.value, 0),
  totalQty: sampleItems.reduce((s, i) => s + i.qty, 0),
};
>>>>>>> fea0a82cfd606a9ad96144983f837e51af84636f
