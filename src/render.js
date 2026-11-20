'use strict';

const fs = require('fs');
const path = require('path');

const REPO_URL = 'https://github.com/braabormo/oodm-cli';

const DIM_ORDER = [
    'Reusability', 'Maintainability', 'Extensibility',
    'Diagram Fidelity', 'Design Quality', 'Reliability'
];

const DIM_META = {
    Reusability:        { en: 'Reusability',       ar: 'قابلية إعادة الاستخدام' },
    Maintainability:    { en: 'Maintainability',   ar: 'قابلية الصيانة' },
    Extensibility:      { en: 'Extensibility',     ar: 'قابلية التوسعة' },
    'Diagram Fidelity': { en: 'Diagram Fidelity',  ar: 'مطابقة المخططات' },
    'Design Quality':   { en: 'Design Quality',    ar: 'جودة التصميم' },
    Reliability:        { en: 'Reliability',       ar: 'الموثوقية والأمان' }
};

const STATUS_META = {
    excellent:  { en: 'Excellent',    ar: 'ممتاز',       score: 100 },
    good:       { en: 'Good',         ar: 'جيد',         score: 80  },
    acceptable: { en: 'Acceptable',   ar: 'مقبول',       score: 55  },
    poor:       { en: 'Needs Work',   ar: 'يحتاج تحسين', score: 25  },
    na:         { en: 'Not Measured', ar: 'غير مقاس',    score: null }
};

const METRIC_META = {
    1: {
        nameAr: 'الاقتران بين الكائنات (CBO)',
        scaleEn: 'Avg classes coupled / class · Ideal: ≤ 4',
        scaleAr: 'متوسط الكلاسات المرتبطة بكل كلاس · المستهدف: ≤ 4',
        descEn: 'Measures how many other classes each class directly depends on. High coupling makes changes ripple across the codebase and makes testing harder.',
        descAr: 'يقيس متوسط عدد الكلاسات الأخرى التي يعتمد عليها كل كلاس مباشرة. كلما ارتفع الرقم زادت صعوبة تعديل كلاس دون كسر كلاسات أخرى.',
        tipBadEn: 'Break up God classes, inject dependencies through interfaces (DIP), and extract shared logic into focused helper services.',
        tipBadAr: 'قسّم الكلاسات الضخمة (God Classes)، اعتمد على حقن التبعيات عبر الواجهات (Interfaces)، وانقل المنطق المشترك إلى خدمات صغيرة مستقلة.',
        tipGoodEn: 'Great low coupling! Keep classes focused on a single responsibility as new features are added.',
        tipGoodAr: 'اقتران منخفض وممتاز! حافظ على استقلالية الكلاسات ومبدأ المسؤولية الواحدة عند إضافة ميزات جديدة.',
        eval: (v) => (v <= 3 ? ['excellent', 95] : v <= 6 ? ['good', 75] : v <= 10 ? ['acceptable', 48] : ['poor', 20])
    },
    2: {
        nameAr: 'نقص التماسك في الدوال (LCOM)',
        scaleEn: 'Unrelated method pairs · Ideal: 0 – 1',
        scaleAr: 'أزواج الدوال غير المترابطة · المستهدف: 0 – 1',
        descEn: 'Measures whether methods inside a class work on the same fields. A high value means the class is doing multiple unrelated jobs.',
        descAr: 'يقيس مدى ترابط الدوال داخل نفس الكلاس عبر استخدامها لنفس الخصائص (Fields). ارتفاع الرقم يعني أن الكلاس يقوم بعدة مهام غير مترابطة.',
        tipBadEn: 'Split classes with high LCOM into smaller, cohesive classes where each class owns a clear subset of state and behavior.',
        tipBadAr: 'فكّك الكلاسات ذات الرقم المرتفع إلى عدة كلاسات أصغر بحيث يجمع كل كلاس البيانات والدوال التي تعمل عليها معاً فقط.',
        tipGoodEn: 'Strong class cohesion! Your classes group related data and methods cleanly.',
        tipGoodAr: 'تماسك ممتاز داخل الكلاسات! البيانات والدوال منظمة بشكل مترابط وسليم.',
        eval: (v) => (v <= 1 ? ['excellent', 96] : v <= 5 ? ['good', 76] : v <= 15 ? ['acceptable', 45] : ['poor', 18])
    },
    3: {
        nameAr: 'مؤشر قابلية إعادة الاستخدام (Reuse Index)',
        scaleEn: 'QMOOD composite index · Higher is better',
        scaleAr: 'مؤشر QMOOD المركّب · الأعلى أفضل',
        descEn: 'Combines coupling, cohesion, public messaging interface, and design size (QMOOD model) to estimate how reusable the architecture is.',
        descAr: 'مؤشر مركّب (وفق نموذج QMOOD) يجمع بين الاقتران والتماسك وعدد الدوال العامة وحجم التصميم لتقدير سهولة إعادة استخدام مكونات المشروع.',
        tipBadEn: 'Reduce coupling, improve class cohesion, expose clean public methods, and pass --baseline old.json to track progress across releases.',
        tipBadAr: 'قلّل الاقتران وحسّن تماسك الكلاسات واجعل واجهاتها العامة واضحة، ويمكنك استخدام --baseline لمقارنة التحسن بين الإصدارات.',
        tipGoodEn: 'Healthy reusability profile. Use --baseline with a previous JSON report to measure relative improvement over time.',
        tipGoodAr: 'مؤشر إعادة استخدام صحي وجيد. يمكنك حفظ التقرير بصيغة JSON واستخدام --baseline لقياس التحسن مستقبلاً.',
        eval: (v, note) => {
            if ((note || '').includes('normalized')) {
                return v >= 1.1 ? ['excellent', 95] : v >= 0.95 ? ['good', 78] : v >= 0.75 ? ['acceptable', 50] : ['poor', 22];
            }
            return v >= 5 ? ['excellent', 92] : v >= 2 ? ['good', 75] : v >= 0.5 ? ['acceptable', 50] : ['poor', 22];
        }
    },
    4: {
        nameAr: 'مؤشر قابلية الصيانة (MI)',
        scaleEn: 'Scale: 0 – 100 · Ideal: ≥ 80',
        scaleAr: 'المقياس: من 0 إلى 100 · المستهدف: ≥ 80',
        descEn: 'Composite score (0 to 100) combining code volume, cyclomatic complexity, lines of code, and comments to gauge how easy files are to maintain.',
        descAr: 'درجة شاملة من 100 تدمج حجم الكود والتعقيد الدوري وعدد الأسطر والتعليقات لتقدير مدى سهولة قراءة الملفات وتعديلها لاحقاً.',
        tipBadEn: 'Start with the weakest files listed below: break long files into smaller modules, simplify nested conditions, and add brief explanatory comments.',
        tipBadAr: 'ابدأ بأضعف الملفات المذكورة في قسم التفاصيل أدناه: قسّم الملفات الطويلة لوحدات أصغر، بسّط الشروط المتداخلة، وأضف تعليقات توضيحية موجزة.',
        tipGoodEn: 'Your files are clean and maintainable. Keep an eye on the lowest-scoring files in the details section so they do not grow unchecked.',
        tipGoodAr: 'ملفات المشروع سهلة الصيانة والقراءة. راقب فقط أضعف الملفات في قسم التفاصيل لمنع تضخمها مستقبلاً.',
        eval: (v) => (v >= 80 ? ['excellent', v] : v >= 65 ? ['good', v] : v >= 50 ? ['acceptable', v] : ['poor', Math.max(10, v)])
    },
    5: {
        nameAr: 'التعقيد الدوري (Cyclomatic Complexity)',
        scaleEn: 'Avg branches / function · Ideal: ≤ 5',
        scaleAr: 'متوسط المسارات المتفرعة لكل دالة · المستهدف: ≤ 5',
        descEn: 'Counts independent execution paths (if, loops, switch, &&/||) per function. Higher values mean harder debugging and more test cases needed.',
        descAr: 'يحسب متوسط عدد المسارات المنطقية (if، الحلقات، switch، الشروط المركبة) في كل دالة. ارتفاعه يعني صعوبة الفهم والاختبار وزيادة احتمالية الأخطاء.',
        tipBadEn: 'Refactor functions with CC > 10: use early returns (guard clauses), extract sub-functions, or replace large switch/if chains with maps/polymorphism.',
        tipBadAr: 'أعد هيكلة الدوال التي يتجاوز تعقيدها 10: استخدم الإرجاع المبكر (Early Returns)، استخرج دوال فرعية، واستبدل سلاسل if/switch الطويلة بـ Map أو Polymorphism.',
        tipGoodEn: 'Functions are simple and easy to trace. Check if any individual outlier function exceeded 10 in the details section.',
        tipGoodAr: 'متوسط التعقيد ممتاز والدوال سهلة التتبع. تأكد فقط من مراجعة أي دالة فردية تجاوزت 10 في قسم التفاصيل.',
        eval: (v) => (v <= 3 ? ['excellent', 95] : v <= 6 ? ['good', 78] : v <= 10 ? ['acceptable', 48] : ['poor', 20])
    },
    6: {
        nameAr: 'كثافة العيوب المحتملة (Defect Density)',
        scaleEn: 'Static findings / 1,000 SLOC · Ideal: 0',
        scaleAr: 'عدد الملاحظات لكل 1,000 سطر كود · المستهدف: 0',
        descEn: 'Proxy rate of potential bugs and security findings per 1,000 lines of source code (SLOC). Lower means cleaner, safer code.',
        descAr: 'يقيس معدل المشاكل الأمنية وأنماط الأخطاء البرمجية المكتشفة لكل 1,000 سطر كود فعلي. كلما اقترب من الصفر كان الكود أكثر نظافة وأماناً.',
        tipBadEn: 'Resolve every security alert and bug pattern (such as empty catch blocks, mutable defaults, or unsafe calls) listed in the Detailed Findings.',
        tipBadAr: 'عالج الملاحظات الأمنية وأنماط الأخطاء (مثل كتل catch الفارغة أو الاستدعاءات غير الآمنة) الموضحة بالملف والسطر في قسم التفاصيل.',
        tipGoodEn: 'Very low static defect density! Maintain this standard by running OODM in code reviews or CI.',
        tipGoodAr: 'كثافة عيوب منخفضة جداً! حافظ على هذا المستوى بفحص المشروع دورياً قبل كل إصدار.',
        eval: (v) => (v === 0 ? ['excellent', 100] : v <= 2 ? ['good', 80] : v <= 6 ? ['acceptable', 48] : ['poor', 20])
    },
    7: {
        nameAr: 'عمق شجرة الوراثة (DIT)',
        scaleEn: 'Avg inheritance depth · Ideal: 0 – 3',
        scaleAr: 'متوسط مستويات الوراثة · المستهدف: 0 – 3',
        descEn: 'Measures how many parent classes a class inherits from on average. Deep hierarchies (> 4) become fragile and hard to predict.',
        descAr: 'يقيس متوسط عدد مستويات الوراثة للكلاسات. الشجرات العميقة جداً (أكثر من 4 مستويات) تجعل تتبع السلوك صعباً والتعديل خطراً.',
        tipBadEn: 'Flatten deep inheritance chains by preferring composition over inheritance (injecting collaborators instead of subclassing deeply).',
        tipBadAr: 'قلّص سلاسل الوراثة العميقة عبر تفضيل التركيب على الوراثة (Composition over Inheritance) وحقن الكائنات المساعدة بدلاً من التوريث المتعدد.',
        tipGoodEn: 'Healthy, shallow inheritance depth. Classes remain easy to understand without hidden ancestor behavior.',
        tipGoodAr: 'عمق وراثة متوازن وسليم، مما يبقي سلوك الكلاسات واضحاً وسهل التتبع.',
        eval: (v) => (v <= 3 ? ['excellent', 94] : v <= 4.5 ? ['good', 75] : v <= 6 ? ['acceptable', 48] : ['poor', 22])
    },
    8: {
        nameAr: 'عدد الأبناء المباشرين (NOC)',
        scaleEn: 'Avg direct subclasses / class · Ideal: 0 – 4',
        scaleAr: 'متوسط الكلاسات الفرعية لكل كلاس · المستهدف: 0 – 4',
        descEn: 'Measures the average number of immediate subclasses inheriting from each class. Very high NOC increases the blast radius of base-class changes.',
        descAr: 'يقيس متوسط عدد الكلاسات التي ترث مباشرة من كل كلاس. ارتفاعه بشكل مفرط يعني أن أي تعديل في الكلاس الأب قد يؤثر على عدد كبير جداً من الكلاسات.',
        tipBadEn: 'If a single base class has too many children, check whether an interface or strategy pattern would decouple variants more safely.',
        tipBadAr: 'إذا كان هناك كلاس أب واحد له عدد كبير جداً من الأبناء، استبدل الوراثة بـ Interface أو نمط Strategy لتقليل أثر التعديلات.',
        tipGoodEn: 'Balanced inheritance breadth with manageable impact radius.',
        tipGoodAr: 'توزيع متوازن للوراثة بدون تركّز خطير على كلاس أب واحد.',
        eval: (v) => (v <= 3 ? ['excellent', 94] : v <= 6 ? ['good', 76] : v <= 10 ? ['acceptable', 50] : ['poor', 22])
    },
    9: {
        nameAr: 'معامل تعدد الأشكال (Polymorphism Factor)',
        scaleEn: 'Scale: 0.000 – 1.000 · Ideal: ≥ 0.100',
        scaleAr: 'المقياس: من 0.000 إلى 1.000 · المستهدف: ≥ 0.100',
        descEn: 'Ratio of overridden methods to maximum possible overrides across inheritance trees (MOOD metric). Shows how actively polymorphism is used.',
        descAr: 'نسبة الدوال المعاد تعريفها (Overridden) إلى الحد الأقصى الممكن عبر شجرة الوراثة. يوضح مدى الاستفادة من تعدد الأشكال (Polymorphism) لتوسيع النظام.',
        tipBadEn: 'If you use conditional type checks (if type === ...), replace them with polymorphic method overrides or strategy interfaces. (0 is normal if your project favors composition over inheritance.)',
        tipBadAr: 'إذا كان الكود يعتمد على شروط لفحص نوع الكائن (if/switch)، استبدلها بتعدد الأشكال أو Interfaces. (القيمة 0 طبيعية إذا كان المشروع يعتمد على التركيب Composition بدلاً من الوراثة).',
        tipGoodEn: 'Good use of polymorphism! Subclasses extend behavior cleanly without modifying existing callers.',
        tipGoodAr: 'استخدام ممتاز لتعدد الأشكال! يمكنك توسيع النظام بإضافة أنواع جديدة دون تعديل الكود القديم.',
        eval: (v) => (v >= 0.15 ? ['excellent', Math.min(100, 60 + v * 100)] : v >= 0.05 ? ['good', 76] : ['acceptable', v > 0 ? 55 : 45])
    },
    10: {
        nameAr: 'التتبع الهيكلي للمخطط (Structural Traceability)',
        scaleEn: 'Scale: 0% – 100% · Ideal: ≥ 90%',
        scaleAr: 'المقياس: 0% – 100% · المستهدف: ≥ 90%',
        descEn: 'Percentage of classes, methods, and relationships in your UML Class Diagram that actually exist in the source code.',
        descAr: 'نسبة الكلاسات والدوال والعلاقات الموجودة في مخطط الكلاسات (Class Diagram) والتي تم تنفيذها فعلياً في الكود.',
        tipBadEn: 'Review the Structural Traceability gaps below: either implement missing diagram items or update class*.puml to match the current architecture.',
        tipBadAr: 'راجع الفجوات في قسم التفاصيل أدناه: نفّذ الكلاسات/الدوال الناقصة أو حدّث ملف class*.puml ليعكس البنية الفعلية للكود.',
        tipGoodEn: 'Strong alignment between your class diagram and implementation!',
        tipGoodAr: 'تطابق ممتاز بين مخطط الكلاسات والتنفيذ الفعلي في الكود!',
        tipNaEn: 'Add a PlantUML (class*.puml) or JSON class diagram in the project root or ./docs folder, or pass --class-diagram FILE.',
        tipNaAr: 'لتفعيل هذا المعيار، أضف ملف مخطط كلاسات (class*.puml أو class*.json) في المشروع أو مجلد docs، أو مرّر الخيار --class-diagram.',
        eval: (v) => (v >= 90 ? ['excellent', v] : v >= 75 ? ['good', v] : v >= 55 ? ['acceptable', v] : ['poor', Math.max(10, v)])
    },
    11: {
        nameAr: 'المطابقة السلوكية (Behavioral Fidelity)',
        scaleEn: 'Scale: 0% – 100% · Ideal: ≥ 90%',
        scaleAr: 'المقياس: 0% – 100% · المستهدف: ≥ 90%',
        descEn: 'Percentage of messages/calls in your UML Sequence Diagrams whose target classes, methods, and caller references exist in code.',
        descAr: 'نسبة الرسائل والاستدعاءات المرسومة في مخططات التسلسل (Sequence Diagrams) والتي تطابق استدعاءات حقيقية بين الكلاسات في الكود.',
        tipBadEn: 'Inspect the unverified sequence messages below and align method names or call flows between the sequence diagram and code.',
        tipBadAr: 'راجع الاستدعاءات غير المطابقة في قسم التفاصيل وطابق أسماء الدوال وتدفق الاستدعاءات بين مخطط التسلسل والكود.',
        tipGoodEn: 'Your runtime interaction design closely matches the implemented calls.',
        tipGoodAr: 'مطابقة ممتازة بين التفاعلات المخططة والاستدعاءات المنفذة في الكود.',
        tipNaEn: 'Add a PlantUML sequence diagram (seq*.puml) in the project or ./docs folder, or pass --sequence FILE.',
        tipNaAr: 'لتفعيل هذا المعيار، أضف ملف مخطط تسلسل (seq*.puml) في المشروع أو مجلد docs، أو مرّر الخيار --sequence.',
        eval: (v) => (v >= 90 ? ['excellent', v] : v >= 75 ? ['good', v] : v >= 55 ? ['acceptable', v] : ['poor', Math.max(10, v)])
    },
    12: {
        nameAr: 'تغطية حالات الاستخدام (Use Case Coverage)',
        scaleEn: 'Scale: 0% – 100% · Ideal: ≥ 90%',
        scaleAr: 'المقياس: 0% – 100% · المستهدف: ≥ 90%',
        descEn: 'Estimates what percentage of documented user requirements (usecases.txt) have corresponding classes or functions in the codebase.',
        descAr: 'يقيس نسبة حالات الاستخدام (Use Cases) الموثقة في ملف usecases.txt والتي لها دوال أو كلاسات مقابلة في الكود.',
        tipBadEn: 'Check unmatched use cases below. Implement missing features or map them explicitly using "Use Case Name | keyword1, keyword2" in usecases.txt.',
        tipBadAr: 'تحقق من حالات الاستخدام غير المغطاة أدناه؛ نفّذ الميزات الناقصة أو اربطها بكلمات مفتاحية واضحة بصيغة "الاسم | كلمة1, كلمة2" في usecases.txt.',
        tipGoodEn: 'Great traceability from business requirements to code modules!',
        tipGoodAr: 'تغطية ممتازة لمتطلبات المشروع وحالات الاستخدام داخل الكود!',
        tipNaEn: 'Add a usecases.txt file (one use case per line) in the project or ./docs folder, or pass --usecases FILE.',
        tipNaAr: 'لتفعيل هذا المعيار، أنشئ ملف usecases.txt (حالة استخدام في كل سطر) أو مرّر الخيار --usecases.',
        eval: (v) => (v >= 90 ? ['excellent', v] : v >= 75 ? ['good', v] : v >= 55 ? ['acceptable', v] : ['poor', Math.max(10, v)])
    },
    13: {
        nameAr: 'الامتثال المعماري (Architectural Compliance)',
        scaleEn: 'Scale: 0 – 10 · Ideal: ≥ 9.0',
        scaleAr: 'المقياس: من 0 إلى 10 · المستهدف: ≥ 9.0',
        descEn: 'Scores how well cross-layer imports/references respect your architectural boundary rules (e.g., Controllers -> Services -> Repositories).',
        descAr: 'يقيس مدى التزام الملفات بقواعد الطبقات المعمارية (مثل منع طبقة البيانات من استدعاء طبقة الواجهات).',
        tipBadEn: 'Fix the layer violations listed below by inverting dependencies with interfaces or moving shared models to a dedicated domain/core layer.',
        tipBadAr: 'أصلح انتهاكات الطبقات المذكورة أدناه عبر عكس التبعيات بالواجهات أو نقل النماذج المشتركة إلى طبقة Domain مستقلة.',
        tipGoodEn: 'Clean architectural boundaries with minimal or zero layer violations.',
        tipGoodAr: 'التزام معماري ممتاز واحترام واضح لحدود الطبقات.',
        tipNaEn: 'Add an architecture.json file defining "layers" and "allow" rules, or pass --arch FILE / --arch-score N.',
        tipNaAr: 'لتفعيل هذا المعيار، أضف ملف architecture.json يحدد الطبقات المسموحة، أو مرّر --arch FILE أو --arch-score N.',
        eval: (v) => (v >= 9 ? ['excellent', v * 10] : v >= 7.5 ? ['good', v * 10] : v >= 5.5 ? ['acceptable', v * 10] : ['poor', Math.max(10, v * 10)])
    },
    14: {
        nameAr: 'الثغرات الأمنية عالية الخطورة (Security Issues)',
        scaleEn: 'Count of high-severity alerts · Ideal: 0',
        scaleAr: 'عدد الملاحظات عالية الخطورة · المستهدف: 0',
        descEn: 'Counts high-risk static security patterns such as SQL injection, eval/exec, weak hashes (MD5/SHA1), disabled TLS, or unsafe deserialization.',
        descAr: 'يحصي الأنماط الأمنية الخطيرة مثل حقن SQL، استخدام eval/exec، التشفير الضعيف (MD5/SHA1)، أو تعطيل التحقق من شهادات TLS.',
        tipBadEn: 'Fix high-severity security findings immediately: use parameterized SQL queries, replace MD5/SHA1 with SHA-256/bcrypt, move secrets to env vars, and avoid eval/shell injection.',
        tipBadAr: 'عالج الثغرات فوراً: استخدم الاستعلامات المعلمية (Parameterized Queries)، استبدل MD5/SHA1 بـ SHA-256 أو bcrypt، انقل المفاتيح السرية لملف .env، وتجنب eval.',
        tipGoodEn: 'Zero high-severity static security findings! Still review any medium findings and run dependency audits (npm audit / pip-audit).',
        tipGoodAr: 'ممتاز! لم تُكتشف ثغرات عالية الخطورة. احرص أيضاً على مراجعة الملاحظات المتوسطة وفحص المكتبات الخارجية دورياً.',
        eval: (v) => (v === 0 ? ['excellent', 100] : v <= 2 ? ['acceptable', 45] : ['poor', 15])
    },
    15: {
        nameAr: 'تغطية الاختبارات (Test Coverage)',
        scaleEn: 'Scale: 0% – 100% · Ideal: ≥ 80%',
        scaleAr: 'المقياس: 0% – 100% · المستهدف: ≥ 80%',
        descEn: 'Percentage of executable source code lines exercised by your automated test suite (read from JaCoCo, lcov, or Cobertura reports).',
        descAr: 'نسبة أسطر الكود الفعلي التي يتم تشغيلها وفحصها أثناء الاختبارات الآلية (تُقرأ من تقارير JaCoCo أو lcov أو Cobertura).',
        tipBadEn: 'Prioritize unit and integration tests for core business logic, high-complexity functions, and critical edge cases until coverage exceeds 80%.',
        tipBadAr: 'ابدأ بكتابة اختبارات وحدة وتكامل لمنطق العمل الأساسي والدوال عالية التعقيد وحالات الخطأ حتى تتجاوز التغطية 80%.',
        tipGoodEn: 'Solid test coverage! Focus new tests on complex branches and regression edge cases.',
        tipGoodAr: 'تغطية اختبارات ممتازة! استمر في تغطية الحالات الحدية والمسارات المعقدة عند إضافة ميزات جديدة.',
        tipNaEn: 'Run your test suite with coverage enabled to generate lcov.info, jacoco.xml, or cobertura.xml, or pass --coverage-report FILE.',
        tipNaAr: 'لتفعيل هذا المعيار، شغّل اختبارات مشروعك مع تفعيل التغطية لتوليد lcov.info أو jacoco.xml أو coverage.xml ثم أعد الفحص.',
        eval: (v) => (v >= 80 ? ['excellent', v] : v >= 60 ? ['good', v] : v >= 40 ? ['acceptable', v] : ['poor', Math.max(10, v)])
    },
    16: {
        nameAr: 'جودة الأسلوب وقابلية القراءة (Style Score)',
        scaleEn: 'Scale: 0 – 10 · Ideal: ≥ 8.5',
        scaleAr: 'المقياس: من 0 إلى 10 · المستهدف: ≥ 8.5',
        descEn: 'Scores code readability and adherence to conventions (line length ≤ 100, naming, function length ≤ 50, parameter count ≤ 5, nesting ≤ 4, docs).',
        descAr: 'درجة من 10 تقيس نظافة الكود والتزامه بقواعد التنسيق (طول السطر ≤ 100، التسمية السليمة، طول الدالة ≤ 50، عدد المعاملات ≤ 5، التداخل ≤ 4، والتوثيق).',
        tipBadEn: 'Check "Most frequent style issues" below: enable an auto-formatter (Prettier/Black/Spotless), break long functions, and document public APIs (or use --no-docstring-check if docs are optional).',
        tipBadAr: 'راجع "أكثر مشاكل الأسلوب تكراراً" أدناه: فعّل منسّق كود تلقائي (Prettier/Black)، اختصر الدوال الطويلة، وأضف توثيقاً للدوال العامة (أو استخدم --no-docstring-check إذا لم يكن التوثيق مطلوباً).',
        tipGoodEn: 'Clean, consistent, and readable codebase!',
        tipGoodAr: 'كود نظيف ومتسق وسهل القراءة!',
        eval: (v) => (v >= 8.5 ? ['excellent', v * 10] : v >= 7.0 ? ['good', v * 10] : v >= 5.0 ? ['acceptable', v * 10] : ['poor', Math.max(10, v * 10)])
    }
};

const DETAIL_META = {
    'CBO - most coupled classes': {
        en: 'Most Coupled Classes (Highest CBO)',
        ar: 'أكثر الكلاسات اقتراناً (الأعلى في CBO)',
        descEn: 'Classes connected to the largest number of other classes. Consider decoupling these first.',
        descAr: 'الكلاسات المرتبطة بأكبر عدد من الكلاسات الأخرى؛ ابدأ بفك الارتباط منها لتقليل هشاشة التصميم.',
        tone: 'warn'
    },
    'LCOM - least cohesive classes': {
        en: 'Least Cohesive Classes (Highest LCOM)',
        ar: 'أقل الكلاسات تماسكاً (الأعلى في LCOM)',
        descEn: 'Classes whose methods rarely share fields—strong candidates to be split into smaller classes.',
        descAr: 'كلاسات تحتوي على دوال لا تتشارك نفس البيانات، ما يعني أنها مرشحة بقوة للتقسيم إلى كلاسات أصغر.',
        tone: 'warn'
    },
    'MI - weakest files': {
        en: 'Hardest-to-Maintain Files (Lowest MI)',
        ar: 'أصعب الملفات في الصيانة (الأقل في MI)',
        descEn: 'Files with the lowest Maintainability Index (0–100). Files below 65 deserve refactoring.',
        descAr: 'الملفات الحاصلة على أدنى درجة في مؤشر الصيانة (من 100). الملفات الأقل من 65 تحتاج إعادة هيكلة وتقسيم.',
        tone: 'warn'
    },
    'CC - most complex functions': {
        en: 'Most Complex Functions (Highest CC)',
        ar: 'أكثر الدوال تعقيداً (الأعلى في CC)',
        descEn: 'Functions with the most conditional branches and loops. Target ≤ 10 per function.',
        descAr: 'الدوال التي تحتوي على أكبر عدد من التفرعات والشروط. يُنصح بألا تتجاوز أي دالة القيمة 10.',
        tone: 'warn'
    },
    'Bug-pattern findings': {
        en: 'Potential Bug Patterns',
        ar: 'أنماط أخطاء برمجية محتملة',
        descEn: 'Suspicious code constructs like swallowed exceptions, unreachable code, or mutable defaults.',
        descAr: 'أنماط برمجية تسبب أخطاء خفية مثل كتل catch الفارغة أو الكود غير القابل للوصول.',
        tone: 'danger'
    },
    'Security findings': {
        en: 'Security Findings',
        ar: 'الملاحظات والتحذيرات الأمنية',
        descEn: 'Static security patterns detected in source code. High-severity findings should be fixed immediately.',
        descAr: 'مشاكل أمنية محتملة تم رصدها في الكود؛ يجب معالجة الملاحظات عالية الخطورة (HIGH) فوراً.',
        tone: 'danger'
    },
    'Structural Traceability - gaps': {
        en: 'Class Diagram Traceability Gaps',
        ar: 'فجوات مطابقة مخطط الكلاسات',
        descEn: 'Classes, methods, or relations present in the diagram but missing from code (or vice versa).',
        descAr: 'عناصر موجودة في مخطط الكلاسات ولم تُعثر عليها في الكود (أو العكس).',
        tone: 'info'
    },
    'Behavioral Fidelity - gaps': {
        en: 'Sequence Diagram Fidelity Gaps',
        ar: 'فجوات مطابقة مخطط التسلسل',
        descEn: 'Sequence diagram messages whose target method or caller invocation could not be verified.',
        descAr: 'استدعاءات مرسومة في مخطط التسلسل ولم يتم التحقق من وجودها في الكود.',
        tone: 'info'
    },
    'Use Case Coverage - gaps': {
        en: 'Unmatched Use Cases',
        ar: 'حالات الاستخدام غير المغطاة',
        descEn: 'Use cases from usecases.txt that did not match any class or function name.',
        descAr: 'حالات استخدام في ملف usecases.txt لم يظهر لها مقابل واضح في أسماء الكلاسات أو الدوال.',
        tone: 'info'
    },
    'Architectural Compliance - violations': {
        en: 'Architectural Layer Violations',
        ar: 'انتهاكات قواعد الطبقات المعمارية',
        descEn: 'Cross-layer dependencies that violate the rules configured in architecture.json.',
        descAr: 'اعتماديات بين طبقات غير مسموح بها وفق قواعد ملف architecture.json.',
        tone: 'danger'
    },
    'Style - most frequent issues': {
        en: 'Most Frequent Style Issues',
        ar: 'أكثر مشاكل الأسلوب والتنسيق تكراراً',
        descEn: 'Summary of the top recurring readability/convention findings—fixing these boosts your Style Score fastest.',
        descAr: 'ملخص لأكثر الملاحظات تكراراً؛ إصلاح أعلى بندين هنا سيرفع درجة الأسلوب لديك بسرعة كبيرة.',
        tone: 'info'
    },
    'Style findings (first 100)': {
        en: 'Detailed Style & Readability Findings (Top 100)',
        ar: 'تفاصيل ملاحظات الأسلوب والتنسيق (أول 100)',
        descEn: 'Exact file locations and line numbers for naming, length, nesting, and documentation findings.',
        descAr: 'الموقع الدقيق بالملف ورقم السطر لكل ملاحظة تنسيق أو تسمية أو طول دالة.',
        tone: 'info'
    },
    'Files that could not be parsed': {
        en: 'Skipped / Unparsed Files',
        ar: 'ملفات تعذّر تحليلها',
        descEn: 'Files skipped due to size (> 2 MB) or read errors.',
        descAr: 'ملفات تم تجاوزها بسبب حجمها الكبير (> 2 ميجابايت) أو خطأ في القراءة.',
        tone: 'info'
    },
    'Files skipped': {
        en: 'Skipped Files (Missing Parser)',
        ar: 'ملفات متجاوزة',
        descEn: 'Files whose language parser was unavailable.',
        descAr: 'ملفات لم يتوفر لها محلل لغة.',
        tone: 'info'
    }
};

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getLogoHtml() {
    const candidates = [
        path.join(__dirname, '..', 'assets', 'logo.png'),
        path.join(__dirname, '..', 'assets', 'logo.svg')
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) {
            try {
                const buf = fs.readFileSync(p);
                const mime = p.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
                return `<img class="brand-logo-img" src="data:${mime};base64,${buf.toString('base64')}" alt="OODM">`;
            } catch {
                // fall back to inline SVG
            }
        }
    }
    // Crisp vector fallback matching the exact OODM >_ brand logo (#00B4FF + #FFFFFF)
    return `<svg class="brand-logo-svg" viewBox="0 0 210 46" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="OODM">
    <text x="2" y="34" font-family="Google Sans, Segoe UI, sans-serif" font-weight="800" font-size="33" letter-spacing="1">
      <tspan fill="#00B4FF">O</tspan><tspan fill="#FFFFFF">ODM</tspan>
    </text>
    <path d="M148 13 L172 24 L148 35" stroke="#00B4FF" stroke-width="5.5" stroke-linecap="square" stroke-linejoin="miter"/>
    <rect x="178" y="33" width="24" height="5.5" fill="#00B4FF"/>
  </svg>`;
}

function evaluateMetric(r) {
    const meta = METRIC_META[r.id];
    if (!meta || r.value === null || r.value === undefined) {
        return { status: 'na', pct: 0 };
    }
    const [status, pct] = meta.eval(r.value, r.note);
    return { status, pct: Math.max(4, Math.min(100, Math.round(pct))) };
}

function parseDetailItem(sectionKey, raw) {
    const str = String(raw);
    let m;

    if ((m = /^\[(high|medium|low|convention|warning|refactor)\]\s+(\S+:\d+)\s{2,}(.+)$/i.exec(str))) {
        const tag = m[1].toLowerCase();
        const cls = tag === 'high' ? 'b-poor' : (tag === 'medium' || tag === 'warning') ? 'b-acceptable'
            : tag === 'refactor' ? 'b-purple' : 'b-good';
        return { badge: tag.toUpperCase(), badgeCls: cls, primary: m[2], secondary: m[3] };
    }
    if (sectionKey === 'CC - most complex functions' && (m = /^(\d+)\s{2,}(.+?)\s+\(([^)]+)\)$/.exec(str))) {
        const v = parseInt(m[1], 10);
        const cls = v > 15 ? 'b-poor' : v > 10 ? 'b-acceptable' : 'b-good';
        return { badge: `CC ${v}`, badgeCls: cls, primary: m[2], secondary: m[3] };
    }
    if (sectionKey === 'MI - weakest files' && (m = /^(\d+(?:\.\d+)?)\s{2,}(.+)$/.exec(str))) {
        const v = parseFloat(m[1]);
        const cls = v < 50 ? 'b-poor' : v < 65 ? 'b-acceptable' : v < 80 ? 'b-good' : 'b-excellent';
        return { badge: `MI ${m[1]}`, badgeCls: cls, primary: m[2], secondary: '' };
    }
    if (sectionKey === 'CBO - most coupled classes' && (m = /^([^:]+):\s*(\d+)\s*\((.*)\)$/.exec(str))) {
        const v = parseInt(m[2], 10);
        const cls = v > 10 ? 'b-poor' : v > 6 ? 'b-acceptable' : 'b-good';
        return { badge: `CBO ${v}`, badgeCls: cls, primary: m[1], secondary: m[3] };
    }
    if (sectionKey === 'LCOM - least cohesive classes' && (m = /^([^:]+):\s*(\d+)$/.exec(str))) {
        const v = parseInt(m[2], 10);
        const cls = v > 15 ? 'b-poor' : v > 5 ? 'b-acceptable' : 'b-good';
        return { badge: `LCOM ${v}`, badgeCls: cls, primary: m[1], secondary: '' };
    }
    if (sectionKey === 'Style - most frequent issues' && (m = /^(\d+)\s+x\s+(.+)$/.exec(str))) {
        return { badge: `${m[1]}×`, badgeCls: 'b-good', primary: m[2], secondary: '' };
    }
    if ((m = /^(\S+:\d+)\s{2,}(.+)$/.exec(str))) {
        return { badge: 'BUG', badgeCls: 'b-poor', primary: m[1], secondary: m[2] };
    }
    return { badge: 'INFO', badgeCls: 'b-na', primary: str, secondary: '' };
}

function renderTable(rep, showDetails, limit) {
    const s = rep.summary;
    const langs = Object.entries(s.languages || {}).sort().map(([k, v]) => `${k} ${v}`).join(', ');
    const out = [
        `oodm ${rep.version} - ${s.files} files (${langs}), ${s.classes} classes, ${s.sloc} SLOC  [${rep.root}]`,
        ''
    ];
    const head = ['#', 'Metric', 'Value', 'Better', 'Source', 'Note'];
    const rows = rep.metrics.map((r) => [String(r.id), r.metric, r.display, r.better, r.source, r.note]);
    const w = [0, 1, 2, 3, 4].map((i) => Math.max(head[i].length, ...rows.map((x) => x[i].length)));
    const fmt = (t) => [0, 1, 2, 3, 4].map((i) => t[i].padEnd(w[i])).join('  ') + '  ' + t[5];

    out.push(fmt(head));
    out.push(w.map((x) => '-'.repeat(x)).join('  ') + '  ----');

    const byDim = {};
    for (let i = 0; i < rep.metrics.length; i++) {
        const dim = rep.metrics[i].dimension;
        if (!byDim[dim]) byDim[dim] = [];
        byDim[dim].push(rows[i]);
    }
    for (const dim of DIM_ORDER) {
        if (byDim[dim] && byDim[dim].length) {
            out.push(`[${dim}]`);
            for (const t of byDim[dim]) out.push(fmt(t));
        }
    }
    if (showDetails) {
        for (const [title, items] of Object.entries(rep.details)) {
            out.push('', '== ' + title);
            for (const item of items.slice(0, limit)) out.push('  ' + item);
            if (items.length > limit) {
                out.push(`  ... +${items.length - limit} more (see --format json)`);
            }
        }
    }
    return out.join('\n');
}

function csvCell(v) {
    const str = String(v);
    return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function renderCsv(rep) {
    const lines = [['#', 'Metric', 'Dimension', 'Value', 'Better', 'Source', 'Note'].map(csvCell).join(',')];
    for (const r of rep.metrics) {
        const val = r.value === null ? '' : Number(r.value.toFixed(4));
        lines.push([r.id, r.metric, r.dimension, val, r.better, r.source, r.note].map(csvCell).join(','));
    }
    return lines.join('\n') + '\n';
}

function renderMd(rep) {
    const lines = [
        '| # | Metric | Dimension | Value | Better | Source | Note |',
        '|---|---|---|---|---|---|---|'
    ];
    for (const r of rep.metrics) {
        lines.push(`| ${r.id} | ${r.metric} | ${r.dimension} | ${r.display} | ${r.better} | ${r.source} | ${r.note.replace(/\|/g, '/')} |`);
    }
    return lines.join('\n') + '\n';
}

function renderHtml(rep) {
    const summary = rep.summary;
    const logoHtml = getLogoHtml();
    const counts = { excellent: 0, good: 0, acceptable: 0, poor: 0, na: 0 };
    const enriched = rep.metrics.map((r) => {
        const { status, pct } = evaluateMetric(r);
        counts[status] += 1;
        return { ...r, status, pct, meta: METRIC_META[r.id] };
    });

    const scored = enriched.filter((m) => m.status !== 'na');
    const overallScore = scored.length
        ? Math.round(scored.reduce((acc, m) => acc + STATUS_META[m.status].score, 0) / scored.length)
        : 0;
    const overallStatus = overallScore >= 85 ? 'excellent' : overallScore >= 70 ? 'good' : overallScore >= 50 ? 'acceptable' : 'poor';
    const circumference = 2 * Math.PI * 44;
    const dashOffset = (circumference * (1 - overallScore / 100)).toFixed(1);

    const priorityItems = enriched
        .filter((m) => m.status === 'poor' || m.status === 'acceptable')
        .sort((a, b) => (a.status === 'poor' ? 0 : 1) - (b.status === 'poor' ? 0 : 1));

    let priorityHtml = '';
    if (priorityItems.length > 0) {
        const cards = priorityItems.map((m) => {
            const st = STATUS_META[m.status];
            return `<div class="action-item st-${m.status}">
        <div class="action-top">
          <div class="action-title">
            <span class="badge b-${m.status}" data-en="${escapeHtml(st.en)}" data-ar="${escapeHtml(st.ar)}">${escapeHtml(st.ar)}</span>
            <strong data-en="#${m.id} ${escapeHtml(m.metric)}" data-ar="#${m.id} ${escapeHtml(m.meta.nameAr)}">#${m.id} ${escapeHtml(m.meta.nameAr)}</strong>
          </div>
          <span class="action-val">${escapeHtml(m.display)}</span>
        </div>
        <p class="action-tip" data-en="${escapeHtml(m.meta.tipBadEn)}" data-ar="${escapeHtml(m.meta.tipBadAr)}">${escapeHtml(m.meta.tipBadAr)}</p>
      </div>`;
        }).join('');
        priorityHtml = `<section class="panel priority-panel">
      <div class="panel-head">
        <div>
          <h2 data-en="Priority Improvement Plan" data-ar="خطة التحسين ذات الأولوية">خطة التحسين ذات الأولوية</h2>
          <p class="panel-sub" data-en="Focus on these metrics first to get the biggest quality boost." data-ar="ابدأ بهذه المعايير أولاً لتحقيق أكبر تحسّن ممكن في جودة المشروع.">ابدأ بهذه المعايير أولاً لتحقيق أكبر تحسّن ممكن في جودة المشروع.</p>
        </div>
        <span class="count-pill warn-pill">${priorityItems.length}</span>
      </div>
      <div class="action-grid">${cards}</div>
    </section>`;
    } else {
        priorityHtml = `<section class="panel success-banner">
      <strong data-en="Great job! All measured metrics are in the Good or Excellent range." data-ar="عمل رائع! جميع المعايير المقاسة في مستوى جيد أو ممتاز.">عمل رائع! جميع المعايير المقاسة في مستوى جيد أو ممتاز.</strong>
      <span data-en="Keep maintaining these standards and consider enabling any unmeasured metrics (like Test Coverage or Architecture rules)." data-ar="حافظ على هذا المستوى، ويمكنك تفعيل المعايير غير المقاسة (مثل تغطية الاختبارات أو القواعد المعمارية) لنظرة أشمل.">حافظ على هذا المستوى، ويمكنك تفعيل المعايير غير المقاسة (مثل تغطية الاختبارات أو القواعد المعمارية) لنظرة أشمل.</span>
    </section>`;
    }

    const metricCardsHtml = enriched.map((m) => {
        const dim = DIM_META[m.dimension] || { en: m.dimension, ar: m.dimension };
        const st = STATUS_META[m.status];
        const meta = m.meta;

        let tipEn, tipAr;
        if (m.status === 'na') {
            tipEn = meta.tipNaEn || meta.tipBadEn;
            tipAr = meta.tipNaAr || meta.tipBadAr;
        } else if (m.status === 'poor' || m.status === 'acceptable') {
            tipEn = meta.tipBadEn;
            tipAr = meta.tipBadAr;
        } else {
            tipEn = meta.tipGoodEn;
            tipAr = meta.tipGoodAr;
        }

        const barHtml = m.status !== 'na'
            ? `<div class="bar-track"><div class="bar-fill fill-${m.status}" style="width:${m.pct}%"></div></div>`
            : `<div class="bar-track"><div class="bar-fill fill-na" style="width:0%"></div></div>`;

        return `<article class="m-card st-${m.status}" data-status="${m.status}" data-dim="${escapeHtml(m.dimension)}">
      <div class="m-head">
        <div>
          <div class="m-meta-row">
            <span class="m-id">#${m.id}</span>
            <span class="m-dim" data-en="${escapeHtml(dim.en)}" data-ar="${escapeHtml(dim.ar)}">${escapeHtml(dim.ar)}</span>
          </div>
          <h3 class="m-name" data-en="${escapeHtml(m.metric)}" data-ar="${escapeHtml(meta.nameAr)}">${escapeHtml(meta.nameAr)}</h3>
        </div>
        <span class="badge b-${m.status}" data-en="${escapeHtml(st.en)}" data-ar="${escapeHtml(st.ar)}">${escapeHtml(st.ar)}</span>
      </div>

      <div class="m-score-box">
        <div class="m-val-row">
          <span class="m-val val-${m.status}">${escapeHtml(m.display)}</span>
          <span class="m-scale" data-en="${escapeHtml(meta.scaleEn)}" data-ar="${escapeHtml(meta.scaleAr)}">${escapeHtml(meta.scaleAr)}</span>
        </div>
        ${barHtml}
      </div>

      <p class="m-desc" data-en="${escapeHtml(meta.descEn)}" data-ar="${escapeHtml(meta.descAr)}">${escapeHtml(meta.descAr)}</p>

      <div class="m-tip tip-${m.status}">
        <span class="tip-label" data-en="${m.status === 'na' ? 'How to enable:' : (m.status === 'poor' || m.status === 'acceptable') ? 'How to improve:' : 'Status note:'}" data-ar="${m.status === 'na' ? 'كيف تفعّل المعيار:' : (m.status === 'poor' || m.status === 'acceptable') ? 'نصيحة للتحسين:' : 'ملاحظة:'}">${m.status === 'na' ? 'كيف تفعّل المعيار:' : (m.status === 'poor' || m.status === 'acceptable') ? 'نصيحة للتحسين:' : 'ملاحظة:'}</span>
        <span data-en="${escapeHtml(tipEn)}" data-ar="${escapeHtml(tipAr)}">${escapeHtml(tipAr)}</span>
      </div>

      <div class="m-foot">
        <span class="m-note">${escapeHtml(m.note)}</span>
        <span class="m-src">${escapeHtml(m.source)}</span>
      </div>
    </article>`;
    }).join('');

    const dimButtonsHtml = DIM_ORDER.map((d) => {
        const dm = DIM_META[d];
        return `<button class="chip" data-dim-filter="${escapeHtml(d)}" onclick="setDimFilter('${escapeHtml(d)}')" data-en="${escapeHtml(dm.en)}" data-ar="${escapeHtml(dm.ar)}">${escapeHtml(dm.ar)}</button>`;
    }).join('');

    const detailKeys = Object.keys(rep.details);
    const detailsHtml = detailKeys.length > 0 ? detailKeys.map((key, idx) => {
        const items = rep.details[key];
        const dm = DETAIL_META[key] || { en: key, ar: key, descEn: '', descAr: '', tone: 'info' };
        const rowsHtml = items.slice(0, 100).map((item) => {
            const parsed = parseDetailItem(key, item);
            const searchText = escapeHtml(String(item).toLowerCase());
            return `<div class="d-row" data-search="${searchText}">
        <span class="badge ${parsed.badgeCls} d-badge">${escapeHtml(parsed.badge)}</span>
        <code class="d-primary">${escapeHtml(parsed.primary)}</code>
        ${parsed.secondary ? `<span class="d-sec">${escapeHtml(parsed.secondary)}</span>` : ''}
      </div>`;
        }).join('');

        const openAttr = idx < 3 ? ' open' : '';
        return `<details class="d-card tone-${dm.tone}"${openAttr}>
      <summary class="d-sum">
        <div class="d-sum-text">
          <strong data-en="${escapeHtml(dm.en)}" data-ar="${escapeHtml(dm.ar)}">${escapeHtml(dm.ar)}</strong>
          ${dm.descAr ? `<small data-en="${escapeHtml(dm.descEn)}" data-ar="${escapeHtml(dm.descAr)}">${escapeHtml(dm.descAr)}</small>` : ''}
        </div>
        <span class="d-count">${items.length}</span>
      </summary>
      <div class="d-list">${rowsHtml}</div>
    </details>`;
    }).join('') : `<p class="empty-msg" data-en="No issues or detailed warnings were reported." data-ar="لم يتم رصد أي ملاحظات أو تحذيرات تفصيلية.">لم يتم رصد أي ملاحظات أو تحذيرات تفصيلية.</p>`;

    const langTags = Object.entries(summary.languages || {}).sort()
        .map(([k, v]) => `<span class="lang-tag">${escapeHtml(k)} <b>${v}</b></span>`).join('') || '—';

    const scanDate = new Date().toISOString().slice(0, 10);

    return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OODM · تقرير جودة الكود</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Google+Sans+Code:wght@400;600&family=Google+Sans:wght@400;500;700&display=swap" rel="stylesheet">
<style>
:root{
  --brand:#00B4FF;
  --brand-dark:#008ECC;
  --brand-soft:#EBF8FF;
  --brand-bd:#B3E8FF;
  --ink-dark:#0B1628;
  --bg:#F5FAFF;
  --surface:#FFFFFF;
  --surface-2:#F8FCFF;
  --border:#E2EEF8;
  --text:#0F172A;
  --muted:#475569;
  --subtle:#64748B;
  --ex:#059669;--ex-bg:#ECFDF5;--ex-bd:#A7F3D0;
  --gd:#008ECC;--gd-bg:#EBF8FF;--gd-bd:#99E1FF;
  --ac:#D97706;--ac-bg:#FFFBEB;--ac-bd:#FDE68A;
  --pr:#E11D48;--pr-bg:#FFF1F2;--pr-bd:#FECDD3;
  --na:#64748B;--na-bg:#F1F5F9;--na-bd:#CBD5E1;
  --pu:#7C3AED;--pu-bg:#F5F3FF;--pu-bd:#DDD6FE;
  --radius:16px;
  --shadow:0 2px 6px rgba(0,180,255,.05),0 8px 24px rgba(15,23,42,.04);
  font-family:"Google Sans","Google Sans Flex","Segoe UI",Tahoma,system-ui,-apple-system,sans-serif;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);line-height:1.6}

/* Topbar: crisp white with #00B4FF accent and dark logo pill for pure white+blue logo contrast */
.topbar{position:sticky;top:0;z-index:20;background:rgba(255,255,255,.94);backdrop-filter:blur(12px);border-bottom:2px solid var(--brand-soft);box-shadow:0 2px 14px rgba(0,180,255,.07)}
.topbar-inner{max-width:1360px;margin:auto;padding:12px 22px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:14px}
.logo-frame{background:var(--ink-dark);border:1.5px solid rgba(0,180,255,.45);border-radius:12px;padding:7px 14px;display:inline-flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(0,180,255,.18);flex-shrink:0;text-decoration:none}
.brand-logo-img{height:24px;width:auto;display:block}
.brand-logo-svg{height:24px;width:auto;display:block}
.brand h1{margin:0;font-size:17px;font-weight:700;line-height:1.25;color:var(--text)}
.brand .path{font-size:12px;color:var(--subtle);direction:ltr;unicode-bidi:plaintext;word-break:break-all}

.lang-switch{display:inline-flex;background:var(--brand-soft);border:1px solid var(--brand-bd);border-radius:11px;padding:3px;gap:3px}
.lang-switch button{border:0;background:transparent;padding:7px 15px;border-radius:8px;cursor:pointer;font-family:inherit;font-weight:700;font-size:13px;color:var(--brand-dark);transition:.15s}
.lang-switch button.active{background:var(--brand);color:#fff;box-shadow:0 2px 8px rgba(0,180,255,.35)}

.wrap{max-width:1360px;margin:auto;padding:24px 22px 56px}

/* Hero Overview */
.hero{display:grid;grid-template-columns:330px 1fr;gap:18px;margin-bottom:22px}
.score-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:22px;box-shadow:var(--shadow);display:flex;align-items:center;gap:18px;position:relative;overflow:hidden}
.score-card::after{content:"";position:absolute;inset-inline:0;top:0;height:4px;background:var(--brand)}
.ring-wrap{position:relative;width:104px;height:104px;flex-shrink:0}
.ring-wrap svg{width:104px;height:104px;transform:rotate(-90deg)}
.ring-bg{fill:none;stroke:#E6F2FA;stroke-width:9}
.ring-fg{fill:none;stroke-width:9;stroke-linecap:round;transition:stroke-dashoffset .5s ease}
.ring-fg.s-excellent{stroke:var(--ex)}.ring-fg.s-good{stroke:var(--brand)}.ring-fg.s-acceptable{stroke:var(--ac)}.ring-fg.s-poor{stroke:var(--pr)}
.ring-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.ring-center b{font-size:25px;font-weight:700;line-height:1;color:var(--text)}
.ring-center small{font-size:11px;color:var(--subtle);margin-top:3px}
.score-info h2{margin:0 0 6px;font-size:16px;font-weight:700}
.score-info p{margin:6px 0 0;font-size:12.5px;color:var(--subtle)}

.stats-panel{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:20px 22px;box-shadow:var(--shadow);display:flex;flex-direction:column;justify-content:space-between;gap:16px}
.kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.kpi{background:var(--surface-2);border:1px solid var(--border);border-radius:12px;padding:13px 15px;transition:.15s}
.kpi:hover{border-color:var(--brand-bd)}
.kpi span{display:block;font-size:12px;color:var(--subtle)}
.kpi b{display:block;font-size:23px;font-weight:700;margin-top:4px;color:var(--text)}
.status-strip{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding-top:12px;border-top:1px solid var(--border)}
.dist-pills,.lang-tags{display:flex;gap:7px;flex-wrap:wrap;align-items:center}
.lang-tag{background:var(--brand-soft);border:1px solid var(--brand-bd);padding:4px 11px;border-radius:999px;font-size:12px;color:var(--brand-dark);font-weight:500}
.lang-tag b{color:var(--ink-dark);margin-inline-start:4px}

/* Badges */
.badge{display:inline-flex;align-items:center;padding:3px 10px;border-radius:999px;font-size:11.5px;font-weight:700;border:1px solid transparent;white-space:nowrap}
.b-excellent{background:var(--ex-bg);color:var(--ex);border-color:var(--ex-bd)}
.b-good{background:var(--gd-bg);color:var(--gd);border-color:var(--gd-bd)}
.b-acceptable{background:var(--ac-bg);color:var(--ac);border-color:var(--ac-bd)}
.b-poor{background:var(--pr-bg);color:var(--pr);border-color:var(--pr-bd)}
.b-na{background:var(--na-bg);color:var(--na);border-color:var(--na-bd)}
.b-purple{background:var(--pu-bg);color:var(--pu);border-color:var(--pu-bd)}

/* Panels */
.panel{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:22px;box-shadow:var(--shadow);margin-bottom:22px}
.panel-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:16px}
.panel h2{margin:0;font-size:19px;font-weight:700}
.panel-sub{margin:4px 0 0;font-size:13px;color:var(--subtle)}
.count-pill{padding:4px 12px;border-radius:999px;font-weight:700;font-size:13px}
.warn-pill{background:var(--pr-bg);color:var(--pr);border:1px solid var(--pr-bd)}

/* Priority Plan */
.action-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:12px}
.action-item{border:1px solid var(--border);border-radius:12px;padding:14px 16px;background:var(--surface-2)}
.action-item.st-poor{border-inline-start:4px solid var(--pr);background:#FFF9FA}
.action-item.st-acceptable{border-inline-start:4px solid var(--ac);background:#FFFDF5}
.action-top{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px}
.action-title{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:14px}
.action-val{font-weight:700;font-size:14px;color:var(--text);white-space:nowrap}
.action-tip{margin:0;font-size:13px;color:var(--muted)}
.success-banner{background:var(--ex-bg);border-color:var(--ex-bd);color:#065F46;display:flex;flex-direction:column;gap:4px}

/* Filters (#00B4FF active identity) */
.filters{display:flex;flex-direction:column;gap:10px;margin-bottom:18px}
.filter-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.chip{border:1px solid var(--border);background:#fff;color:var(--muted);padding:6px 14px;border-radius:999px;font-family:inherit;font-size:12.5px;font-weight:500;cursor:pointer;transition:.15s}
.chip:hover{border-color:var(--brand);color:var(--brand-dark);background:var(--brand-soft)}
.chip.active{background:var(--brand);color:#fff;border-color:var(--brand);font-weight:700;box-shadow:0 2px 8px rgba(0,180,255,.3)}

/* Metric Cards Grid */
.metrics-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.m-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px;display:flex;flex-direction:column;gap:12px;border-top:4px solid var(--na);transition:box-shadow .15s,border-color .15s}
.m-card:hover{box-shadow:0 10px 26px rgba(0,180,255,.09)}
.m-card.st-excellent{border-top-color:var(--ex)}
.m-card.st-good{border-top-color:var(--brand)}
.m-card.st-acceptable{border-top-color:var(--ac)}
.m-card.st-poor{border-top-color:var(--pr)}
.m-card.hidden{display:none}
.m-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
.m-meta-row{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.m-id{font-size:11.5px;font-weight:700;color:var(--brand-dark);background:var(--brand-soft);border:1px solid var(--brand-bd);padding:1px 7px;border-radius:6px}
.m-dim{font-size:12px;color:var(--subtle);font-weight:500}
.m-name{margin:0;font-size:16px;font-weight:700;line-height:1.35}

.m-score-box{background:var(--surface-2);border:1px solid var(--border);border-radius:11px;padding:12px 14px}
.m-val-row{display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:8px}
.m-val{font-size:24px;font-weight:700;letter-spacing:-.02em;direction:ltr}
.val-excellent{color:var(--ex)}.val-good{color:var(--brand-dark)}.val-acceptable{color:var(--ac)}.val-poor{color:var(--pr)}.val-na{color:var(--na)}
.m-scale{font-size:12px;color:var(--subtle);font-weight:500}
.bar-track{height:7px;background:#E6F2FA;border-radius:999px;overflow:hidden}
.bar-fill{height:100%;border-radius:999px}
.fill-excellent{background:var(--ex)}.fill-good{background:var(--brand)}.fill-acceptable{background:var(--ac)}.fill-poor{background:var(--pr)}.fill-na{background:var(--na)}

.m-desc{margin:0;font-size:13px;color:var(--muted)}
.m-tip{padding:10px 12px;border-radius:10px;font-size:12.5px;line-height:1.55;border:1px solid var(--border);background:var(--surface-2)}
.tip-poor{background:var(--pr-bg);border-color:var(--pr-bd);color:#881337}
.tip-acceptable{background:var(--ac-bg);border-color:var(--ac-bd);color:#78350F}
.tip-excellent,.tip-good{background:var(--ex-bg);border-color:var(--ex-bd);color:#064E3B}
.tip-na{background:var(--brand-soft);border-color:var(--brand-bd);color:#0369A1}
.tip-label{font-weight:700;margin-inline-end:6px}
.m-foot{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding-top:10px;border-top:1px dashed var(--border);font-size:11.5px;color:var(--subtle);margin-top:auto}
.m-note{direction:ltr;unicode-bidi:plaintext}
.m-src{background:var(--surface-2);border:1px solid var(--border);padding:2px 8px;border-radius:6px;font-weight:500}

/* Details Section */
.details-tools{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
.search-input{flex:1;min-width:220px;padding:10px 14px;border:1.5px solid var(--border);border-radius:10px;font-family:inherit;font-size:13.5px;background:var(--surface-2);color:var(--text);outline:none;transition:.15s}
.search-input:focus{border-color:var(--brand);background:#fff;box-shadow:0 0 0 3px rgba(0,180,255,.16)}
.tool-btn{border:1px solid var(--brand-bd);background:var(--brand-soft);color:var(--brand-dark);padding:9px 14px;border-radius:10px;font-family:inherit;font-size:12.5px;font-weight:700;cursor:pointer;transition:.15s}
.tool-btn:hover{background:var(--brand);color:#fff;border-color:var(--brand)}

.d-card{border:1px solid var(--border);border-radius:12px;margin-bottom:10px;background:var(--surface);overflow:hidden}
.d-card.tone-danger{border-inline-start:4px solid var(--pr)}
.d-card.tone-warn{border-inline-start:4px solid var(--ac)}
.d-card.tone-info{border-inline-start:4px solid var(--brand)}
.d-sum{list-style:none;cursor:pointer;padding:14px 16px;display:flex;justify-content:space-between;align-items:center;gap:12px;background:var(--surface-2)}
.d-sum::-webkit-details-marker{display:none}
.d-sum:hover{background:var(--brand-soft)}
.d-sum-text strong{display:block;font-size:14.5px}
.d-sum-text small{display:block;font-size:12.5px;color:var(--subtle);margin-top:2px}
.d-count{background:var(--brand);color:#fff;border-radius:999px;padding:3px 11px;font-size:12px;font-weight:700;flex-shrink:0}
.d-list{padding:8px 14px 12px;display:flex;flex-direction:column;gap:6px}
.d-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 10px;border-radius:9px;background:var(--surface-2);border:1px solid var(--border);font-size:12.5px}
.d-row.hidden{display:none}
.d-badge{min-width:64px;justify-content:center;font-size:11px}
.d-primary{font-family:"Google Sans Code",ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12.5px;color:var(--text);font-weight:600;direction:ltr;unicode-bidi:plaintext;word-break:break-all}
.d-sec{color:var(--muted);font-size:12.5px;direction:ltr;unicode-bidi:plaintext;overflow-wrap:anywhere}
.empty-msg{color:var(--subtle);font-size:13.5px;margin:8px 0}

/* Footer with GitHub project link */
.site-footer{margin-top:28px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:18px 22px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;box-shadow:var(--shadow)}
.footer-left{display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:12.5px;color:var(--subtle)}
.gh-link{display:inline-flex;align-items:center;gap:8px;padding:8px 16px;border-radius:10px;background:var(--brand);color:#fff;text-decoration:none;font-weight:700;font-size:13px;box-shadow:0 3px 10px rgba(0,180,255,.28);transition:.15s;direction:ltr}
.gh-link:hover{background:var(--brand-dark);transform:translateY(-1px)}
.gh-link svg{width:17px;height:17px;fill:currentColor;flex-shrink:0}

@media(max-width:960px){
  .hero{grid-template-columns:1fr}
  .metrics-grid{grid-template-columns:1fr}
  .kpi-grid{grid-template-columns:repeat(2,1fr)}
}
@media print{
  .topbar,.filters,.details-tools{display:none!important}
  body{background:#fff}
  .panel,.score-card,.stats-panel,.m-card,.site-footer{box-shadow:none;break-inside:avoid}
}
</style>
</head>
<body>
<header class="topbar">
  <div class="topbar-inner">
    <div class="brand">
      <a class="logo-frame" href="${REPO_URL}" target="_blank" rel="noopener noreferrer" title="OODM on GitHub">${logoHtml}</a>
      <div>
        <h1 data-en="OODM · Code Quality Report" data-ar="OODM · تقرير جودة الكود والتصميم">OODM · تقرير جودة الكود والتصميم</h1>
        <div class="path">${escapeHtml(rep.root)} · v${escapeHtml(rep.version)} · ${scanDate}</div>
      </div>
    </div>
    <div class="lang-switch">
      <button id="btn-ar" class="active" onclick="setLang('ar')">العربية</button>
      <button id="btn-en" onclick="setLang('en')">English</button>
    </div>
  </div>
</header>

<main class="wrap">
  <section class="hero">
    <div class="score-card">
      <div class="ring-wrap">
        <svg viewBox="0 0 100 100">
          <circle class="ring-bg" cx="50" cy="50" r="44"/>
          <circle class="ring-fg s-${overallStatus}" cx="50" cy="50" r="44" stroke-dasharray="${circumference.toFixed(1)}" stroke-dashoffset="${dashOffset}"/>
        </svg>
        <div class="ring-center">
          <b>${overallScore}%</b>
          <small data-en="Health" data-ar="الصحة">الصحة</small>
        </div>
      </div>
      <div class="score-info">
        <h2 data-en="Overall Code Health" data-ar="التقييم العام للمشروع">التقييم العام للمشروع</h2>
        <span class="badge b-${overallStatus}" data-en="${escapeHtml(STATUS_META[overallStatus].en)}" data-ar="${escapeHtml(STATUS_META[overallStatus].ar)}">${escapeHtml(STATUS_META[overallStatus].ar)}</span>
        <p data-en="Calculated from ${scored.length} of ${enriched.length} measured metrics." data-ar="محسوب من ${scored.length} معيار مقاس من أصل ${enriched.length}.">محسوب من ${scored.length} معيار مقاس من أصل ${enriched.length}.</p>
      </div>
    </div>

    <div class="stats-panel">
      <div class="kpi-grid">
        <div class="kpi"><span data-en="Source Files" data-ar="ملفات المصدر">ملفات المصدر</span><b>${summary.files}</b></div>
        <div class="kpi"><span data-en="Classes & Interfaces" data-ar="الكلاسات والواجهات">الكلاسات والواجهات</span><b>${summary.classes}</b></div>
        <div class="kpi"><span data-en="Source Lines (SLOC)" data-ar="أسطر الكود الفعلية">أسطر الكود الفعلية</span><b>${summary.sloc.toLocaleString()}</b></div>
        <div class="kpi"><span data-en="Test Files" data-ar="ملفات الاختبارات">ملفات الاختبارات</span><b>${summary.test_files}</b></div>
      </div>
      <div class="status-strip">
        <div class="dist-pills">
          <span class="badge b-excellent" data-en="${counts.excellent} Excellent" data-ar="${counts.excellent} ممتاز">${counts.excellent} ممتاز</span>
          <span class="badge b-good" data-en="${counts.good} Good" data-ar="${counts.good} جيد">${counts.good} جيد</span>
          <span class="badge b-acceptable" data-en="${counts.acceptable} Acceptable" data-ar="${counts.acceptable} مقبول">${counts.acceptable} مقبول</span>
          <span class="badge b-poor" data-en="${counts.poor} Needs Work" data-ar="${counts.poor} يحتاج تحسين">${counts.poor} يحتاج تحسين</span>
          <span class="badge b-na" data-en="${counts.na} N/A" data-ar="${counts.na} غير مقاس">${counts.na} غير مقاس</span>
        </div>
        <div class="lang-tags">${langTags}</div>
      </div>
    </div>
  </section>

  ${priorityHtml}

  <section class="panel">
    <div class="panel-head">
      <div>
        <h2 data-en="All 16 Quality Metrics" data-ar="المعايير الـ 16 بالتفصيل">المعايير الـ 16 بالتفصيل</h2>
        <p class="panel-sub" data-en="Each card explains what the metric measures, its target scale, your score, and how to improve it." data-ar="توضح كل بطاقة ماذا يقيس المعيار، والمقياس المستهدف، ودرجة مشروعك الحالية، ونصيحة عملية لتحسينها.">توضح كل بطاقة ماذا يقيس المعيار، والمقياس المستهدف، ودرجة مشروعك الحالية، ونصيحة عملية لتحسينها.</p>
      </div>
    </div>
    <div class="filters">
      <div class="filter-row">
        <button class="chip active" data-st-filter="all" onclick="setStatusFilter('all')" data-en="All Statuses" data-ar="كل الحالات">كل الحالات</button>
        <button class="chip" data-st-filter="attention" onclick="setStatusFilter('attention')" data-en="Needs Attention (${counts.poor + counts.acceptable})" data-ar="يحتاج انتباه (${counts.poor + counts.acceptable})">يحتاج انتباه (${counts.poor + counts.acceptable})</button>
        <button class="chip" data-st-filter="healthy" onclick="setStatusFilter('healthy')" data-en="Healthy (${counts.excellent + counts.good})" data-ar="ممتاز وجيد (${counts.excellent + counts.good})">ممتاز وجيد (${counts.excellent + counts.good})</button>
        <button class="chip" data-st-filter="na" onclick="setStatusFilter('na')" data-en="Not Measured (${counts.na})" data-ar="غير مقاس (${counts.na})">غير مقاس (${counts.na})</button>
      </div>
      <div class="filter-row">
        <button class="chip active" data-dim-filter="all" onclick="setDimFilter('all')" data-en="All Dimensions" data-ar="كل الأبعاد">كل الأبعاد</button>
        ${dimButtonsHtml}
      </div>
    </div>
    <div class="metrics-grid" id="metrics-grid">${metricCardsHtml}</div>
  </section>

  <section class="panel">
    <div class="panel-head">
      <div>
        <h2 data-en="Detailed Findings & Offenders" data-ar="التفاصيل والملاحظات بالملف والسطر">التفاصيل والملاحظات بالملف والسطر</h2>
        <p class="panel-sub" data-en="Exact files, classes, functions, and line numbers behind the numbers above." data-ar="الملفات والكلاسات والدوال وأرقام الأسطر الدقيقة التي تسببت في الدرجات أعلاه.">الملفات والكلاسات والدوال وأرقام الأسطر الدقيقة التي تسببت في الدرجات أعلاه.</p>
      </div>
    </div>
    <div class="details-tools">
      <input id="detail-search" class="search-input" type="search" oninput="filterDetails(this.value)" placeholder="ابحث باسم ملف أو كلاس أو دالة..." data-ph-en="Search by file, class, function, or message..." data-ph-ar="ابحث باسم ملف أو كلاس أو دالة...">
      <button class="tool-btn" onclick="toggleAllDetails(true)" data-en="Expand All" data-ar="توسيع الكل">توسيع الكل</button>
      <button class="tool-btn" onclick="toggleAllDetails(false)" data-en="Collapse All" data-ar="طي الكل">طي الكل</button>
    </div>
    <div id="details-wrap">${detailsHtml}</div>
  </section>

  <footer class="site-footer">
    <div class="footer-left">
      <span data-en="Generated by OODM v${escapeHtml(rep.version)} · Static code analysis report. Review findings in context." data-ar="تم التوليد بواسطة OODM v${escapeHtml(rep.version)} · تحليل ثابت للكود؛ يُنصح بمراجعة الملاحظات ضمن سياق المشروع.">تم التوليد بواسطة OODM v${escapeHtml(rep.version)} · تحليل ثابت للكود؛ يُنصح بمراجعة الملاحظات ضمن سياق المشروع.</span>
    </div>
    <a class="gh-link" href="${REPO_URL}" target="_blank" rel="noopener noreferrer">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.04 11.04 0 0 1 5.8 0c2.21-1.49 3.18-1.18 3.18-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.69 5.4-5.26 5.68.41.36.78 1.06.78 2.14 0 1.55-.01 2.8-.01 3.18 0 .31.21.68.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z"/></svg>
      <span>github.com/braabormo/oodm-cli</span>
    </a>
  </footer>
</main>

<script>
let activeStatus = 'all';
let activeDim = 'all';

function setLang(lang) {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  document.title = lang === 'ar' ? 'OODM · تقرير جودة الكود' : 'OODM · Code Quality Report';
  document.querySelectorAll('[data-en]').forEach((el) => {
    el.textContent = el.dataset[lang];
  });
  const inp = document.getElementById('detail-search');
  if (inp) inp.placeholder = lang === 'ar' ? inp.dataset.phAr : inp.dataset.phEn;
  document.getElementById('btn-ar').classList.toggle('active', lang === 'ar');
  document.getElementById('btn-en').classList.toggle('active', lang === 'en');
}

function applyMetricFilters() {
  document.querySelectorAll('#metrics-grid .m-card').forEach((card) => {
    const st = card.dataset.status;
    const dim = card.dataset.dim;
    const okSt = activeStatus === 'all'
      || (activeStatus === 'attention' && (st === 'poor' || st === 'acceptable'))
      || (activeStatus === 'healthy' && (st === 'excellent' || st === 'good'))
      || st === activeStatus;
    const okDim = activeDim === 'all' || dim === activeDim;
    card.classList.toggle('hidden', !(okSt && okDim));
  });
}

function setStatusFilter(st) {
  activeStatus = st;
  document.querySelectorAll('[data-st-filter]').forEach((b) => b.classList.toggle('active', b.dataset.stFilter === st));
  applyMetricFilters();
}

function setDimFilter(dim) {
  activeDim = dim;
  document.querySelectorAll('[data-dim-filter]').forEach((b) => b.classList.toggle('active', b.dataset.dimFilter === dim));
  applyMetricFilters();
}

function filterDetails(q) {
  const term = q.trim().toLowerCase();
  document.querySelectorAll('#details-wrap .d-card').forEach((card) => {
    let visible = 0;
    card.querySelectorAll('.d-row').forEach((row) => {
      const match = !term || (row.dataset.search || '').includes(term);
      row.classList.toggle('hidden', !match);
      if (match) visible += 1;
    });
    card.style.display = term && visible === 0 ? 'none' : '';
    if (term && visible > 0) card.open = true;
  });
}

function toggleAllDetails(open) {
  document.querySelectorAll('#details-wrap .d-card').forEach((c) => { c.open = open; });
}
</script>
</body>
</html>
`;
}

module.exports = {
    DIM_ORDER,
    renderTable,
    renderCsv,
    renderMd,
    renderHtml
};