# تقسيم الصفحة عند عمل طلبية

عند فتح لوحة الطلبية تُقسّم الصفحة إلى **قسمين**:
- **اليسار:** المنتجات (المربعات) مع إمكانية التمرير لرؤية الكل.
- **اليمين:** لوحة الطلبية.

## التعديلات في `App.jsx`

### 1. الـ wrapper الرئيسي

**قبل:** المحتوى واللوحة يتداخلان (اللوحة `fixed` فوق المحتوى).

**بعد:** عند فتح الطلبية استخدم تخطيطاً flex بحيث المحتوى واللوحة **جنباً إلى جنب** (بدون overlay):

```jsx
// الـ div الخارجي: عند فتح الطلبية اجعله flex-row على الشاشات الكبيرة
<div className={`min-h-screen bg-[#F7F8FF] font-sans flex flex-col ${showOrderPanel ? 'lg:flex-row' : 'lg:flex-row'}`}>
```

أو الأبسط: إبقاء `lg:flex-row` دائماً.

### 2. منطقة المحتوى الرئيسي (المربعات)

يجب أن تكون قابلة للتمرير وتأخذ المساحة المتبقية:

```jsx
<div
  className={`flex-1 min-w-0 min-h-0 p-4 sm:p-6 lg:p-8 xl:p-10 flex flex-col overflow-hidden ${showOrderPanel ? 'lg:max-w-[50%] lg:overflow-auto' : ''}`}
>
  <header>...</header>
  <div className="flex-1 min-h-0 overflow-auto">
    {/* شبكة المنتجات */}
    <div className="grid ... style={{ gridTemplateColumns: '...' }}">
      {items.map(...)}
    </div>
  </div>
</div>
```

- `min-h-0` و `overflow-auto`: يسمحان للمنطقة بالتصغير والتمرير.
- عند فتح الطلبية: `lg:max-w-[50%]` و `lg:overflow-auto` حتى تأخذ المربعات نصف الشاشة ويمكن التمرير لرؤية الكل.

### 3. لوحة الطلبية (aside)

**إزالة `fixed`** عند العرض جنباً إلى جنب حتى لا تغطي المربعات، واستخدام عرض ثابت في التدفق:

```jsx
{showOrderPanel && (
  <aside
    className="flex-shrink-0 w-full lg:w-[50%] lg:min-w-[32rem] lg:max-w-[56rem] h-screen overflow-hidden flex flex-col border-l border-slate-200/80 bg-[#DCE0F5] shadow-2xl z-10"
  >
    {/* محتوى الطلبية */}
  </aside>
)}
```

- بدون `fixed`: اللوحة تأخذ مكانها على اليمين والمحتوى يبقى على اليسار.
- `lg:w-[50%]`: على الشاشات الكبيرة اللوحة تأخذ نصف العرض.
- المحتوى الرئيسي يأخذ النصف الآخر ويمكن التمرير فيه لرؤية **جميع المربعات**.

### 4. ملخص الهيكل النهائي

```jsx
<div className="min-h-screen bg-[#F7F8FF] font-sans flex flex-col lg:flex-row">
  {/* المحتوى الرئيسي — يتقلص عند فتح الطلبية، مع تمرير لعرض كل المربعات */}
  <div className={`flex-1 min-w-0 min-h-0 p-4 sm:p-6 lg:p-8 xl:p-10 flex flex-col overflow-hidden ${showOrderPanel ? 'lg:overflow-auto' : ''}`}>
    <header>...</header>
    <div className="flex-1 min-h-0 overflow-auto">
      <div className="bg-white/90 ...">
        <div className="grid max-h-[75vh] overflow-y-auto ...">
          {items.map((item) => ( ... ))}
        </div>
      </div>
    </div>
  </div>

  {showOrderPanel && (
    <aside className="flex-shrink-0 w-full lg:w-[50%] lg:min-w-[32rem] lg:max-w-[56rem] h-screen overflow-hidden flex flex-col ...">
      {/* طلبية */}
    </aside>
  )}
</div>
```

بهذا عند فتح الطلبية تظهر **جميع المربعات** على اليسار مع التمرير، والطلبية على اليمين.
