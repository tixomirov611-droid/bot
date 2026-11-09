/* NikCar Cloud Console v0.9 — online pilot; restricted operations.
   Production rental accounting/inspections/finance stay in original DEMO until migrated and tested. */
const root=document.getElementById('root');
const cfg=window.NIKCAR_SUPABASE||{};
const authRedirect=cfg.redirectUrl||'https://nikcar-cloud-pilot.onrender.com/';
// Protect Supabase Auth email quota from accidental double clicks/repeated sends.
const authEmailCooldownKey='nikcar-auth-email-last-send';
function authEmailCooldownSeconds(){try{return Math.max(0,Math.ceil((60000-(Date.now()-Number(localStorage.getItem(authEmailCooldownKey)||0)))/1000));}catch(_){return 0;}}
function markAuthEmailSent(){try{localStorage.setItem(authEmailCooldownKey,String(Date.now()));}catch(_){}}
function assertAuthEmailCooldown(){const seconds=authEmailCooldownSeconds();if(seconds)throw Error(lang==='uk'?`Зачекайте ще ${seconds} с перед повторним запитом листа.`:`Wait another ${seconds}s before requesting an email again.`);}
function isAuthEmailRateLimited(err){return err?.status===429||err?.code==='over_email_send_rate_limit'||/email rate limit exceeded|only request this after/i.test(String(err?.message||''));}
function authErrorMessage(err,emailOperation=''){const code=String(err?.code||'').toLowerCase(),message=String(err?.message||'');if(isAuthEmailRateLimited(err)){if(emailOperation){markAuthEmailSent();return authEmailRateLimitMessage();}return lang==='uk'?'Забагато запитів. Спробуйте пізніше.':'Too many requests. Try again later.';}if(emailOperation&&(err?.status>=500||code==='unexpected_failure'||/smtp|error sending .*email|mailer.*error/i.test(message)))return emailOperation==='reset'?(lang==='uk'?'Листа відновлення не надіслано через помилку поштового сервера NikCar. Ваш пароль не змінено. Повідомте адміністратора, щоб він перевірив SMTP у Supabase.':'Password recovery email could not be sent because NikCar mail service is unavailable. Your password was not changed. Ask the administrator to check SMTP in Supabase.'):(lang==='uk'?'Не вдалося надіслати лист NikCar. Поштова служба тимчасово недоступна: адміністратору потрібно перевірити SMTP у Supabase.':'NikCar email could not be sent. The mail service is unavailable; the administrator needs to check SMTP in Supabase.');if(/^(Паролі не збігаються\.|Passwords do not match\.|Пароль повинен містити 10–128 символів\.|Password must have 10–128 characters\.|Зачекайте ще \d+ с перед повторним запитом листа\.|Wait another \d+s before requesting an email again\.)$/.test(message))return message;if(code==='email_not_confirmed'||/email not confirmed/i.test(message))return lang==='uk'?'Підтвердіть електронну пошту за посиланням у листі. Перевірте папку «Спам».':'Confirm your email using the link in your inbox. Check spam as well.';if(code==='invalid_credentials'||/invalid login credentials/i.test(message))return lang==='uk'?'Неправильна пошта або пароль. Перевірте дані чи відновіть пароль.':'Incorrect email or password. Check your details or reset your password.';if(code==='weak_password'||/password.*(?:weak|short|characters)/i.test(message))return lang==='uk'?'Пароль недостатньо надійний. Використайте щонайменше 10 символів.':'Password is too weak. Use at least 10 characters.';if(code==='user_already_exists'||/user already registered/i.test(message))return lang==='uk'?'Ця адреса вже зареєстрована. Спробуйте увійти або відновити пароль.':'This email is already registered. Sign in or reset your password.';if(code==='otp_expired'||code==='otp_disabled'||/token.*(?:expired|invalid)|link.*(?:expired|invalid)/i.test(message))return lang==='uk'?'Посилання недійсне або термін його дії минув. Запитайте новий лист.':'This link is invalid or has expired. Request a new email.';if(code==='over_request_rate_limit'||err?.status===429)return lang==='uk'?'Забагато запитів. Спробуйте пізніше.':'Too many requests. Try again later.';if(typeof navigator!=='undefined'&&navigator.onLine===false)return lang==='uk'?'Немає підключення до інтернету. Спробуйте після відновлення мережі.':'No internet connection. Try again when you are online.';return lang==='uk'?'Не вдалося завершити дію. Перевірте дані та спробуйте ще раз.':'Could not complete this action. Check your details and try again.';}
function authEmailRateLimitMessage(){return lang==='uk'?'Ліміт надсилання листів тимчасово вичерпано в Supabase. Не надсилайте повторні запити: перевірте вже отриманий лист або повторіть спробу пізніше. Для стабільної роботи адміністратор має підключити власний SMTP-сервіс.':'Supabase has temporarily reached its email sending limit. Do not keep retrying: check any email already received or try again later. The administrator must configure custom SMTP for reliable delivery.';}
// The SDK may consume and remove a recovery URL hash during getSession().
const initialAuthHash = new URLSearchParams(location.hash.replace(/^#/, ''));
const initialAuthQuery = new URLSearchParams(location.search);
const initialLinkError=initialAuthHash.get('error_code')||initialAuthQuery.get('error_code')||initialAuthHash.get('error')||initialAuthQuery.get('error');
const initialRecoveryLink = !initialLinkError&&(initialAuthHash.get('type')==='recovery'||initialAuthQuery.get('type')==='recovery');
function readRecoveryPending(){try{const saved=Number(sessionStorage.getItem('nikcar-recovery-pending'));if(!Number.isFinite(saved)||saved<=0||Date.now()-saved>3600000){sessionStorage.removeItem('nikcar-recovery-pending');return false;}return true;}catch(_){return false;}}
function persistRecoveryPending(value){try{if(value)sessionStorage.setItem('nikcar-recovery-pending',String(Date.now()));else sessionStorage.removeItem('nikcar-recovery-pending');}catch(_){}}
function initialLinkErrorMessage(){return lang==='uk'?'Посилання підтвердження або відновлення недійсне чи вже використане. Запитайте новий лист або увійдіть до кабінету.':'Your confirmation or recovery link is invalid, expired, or already used. Request a new email or sign in.';}
const oauthEnabled=cfg.oauthProviders||{};
const configured=/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(cfg.url||'')&&!!cfg.publishableKey;
async function checkOAuthAvailability(){
 try{
  const response=await fetch(cfg.url+'/auth/v1/settings',{headers:{apikey:cfg.publishableKey,'Accept':'application/json'},cache:'no-store'});
  if(!response.ok)return;
  const json=await response.json();
  const providers=json?.external||{};
  for(const provider of ['google','apple','azure','github']){
   if(typeof providers[provider]==='boolean')oauthEnabled[provider]=providers[provider];
  }
  if(!user&&!hasUnsavedForm())render();
 }catch(_err){/* Keep configured status. Unsupported providers remain unavailable. */}
}

const TRANSLATIONS={
 uk:{cars:'Автопарк',requests:'Заявки',chat:'Чат',sos:'SOS',documents:'Документи',account:'Профіль',signout:'Вийти',signin:'Увійти',signup:'Реєстрація',reset:'Відновити пароль',email:'Електронна пошта',password:'Пароль',fullname:'Ім’я та прізвище',create:'Створити обліковий запис',login:'Увійти до NikCar',google:'Увійти через Google',apple:'Увійти через Apple',forgot:'Забули пароль?',registerInfo:'Спочатку виберіть авто та додайте всі 5 документів. Лише після цього можна надіслати заявку власнику.',notConnected:'Хмарний сервер ще не підключено',setup:'Заповніть web/config.js адресою і публічним ключем тестового проєкту Supabase та застосуйте SQL-міграцію. Паролі й фінансові дані не вводьте до перевірки RLS.',cloudPilot:'Хмарний пілот',role:'Роль',access:'Доступ',candidate:'Кандидат',active:'Активний',archived:'Архів',blocked:'Заблоковано',owner:'Власник',driver:'Водій',free:'Вільний',reserved:'Резерв',rented:'В оренді',maintenance:'Сервіс',model:'Модель',plate:'Держномер',year:'Рік',rate:'Тариф / доба',saveCar:'Додати авто',apply:'Подати заявку',approve:'Схвалити',reject:'Відхилити',cancel:'Скасувати',pending:'Очікує',approved:'Схвалено',rejected:'Відхилено',cancelled:'Скасовано',requestTitle:'Заявки на оренду',requestInfo:'Схвалення заявки НЕ означає видачу автомобіля; фотоакт і передача ключів ще не підключені.',noRequests:'Заявок поки немає',noCars:'Автомобілів поки немає',unknown:'Невідомо',saveProfile:'Зберегти профіль',phone:'Телефон',chatTitle:'Загальний чат водіїв',chatInfo:'Доступний власнику та активним водіям. Фото й відео з приватного сховища додамо окремо.',message:'Повідомлення',send:'Надіслати',noChat:'Повідомлень ще немає',restricted:'Доступ відкриється після фактичної видачі автомобіля.',sosTitle:'Взаємодопомога водіїв',sosInfo:'Водії самі беруть заявки. Власник не призначає помічників.',sosType:'Яка допомога потрібна?',jump_start:'Прикурити',tow:'Дотягнути / евакуатор',wheel:'Колесо',other:'Інше',location:'Місце або орієнтир',description:'Опис проблеми',createSos:'Надіслати SOS',claim:'Їду допомагати',release:'Не можу допомогти',complete:'Допомога надана',noSos:'Заявок SOS поки немає',open:'Шукає допомогу',claimed:'Помічник їде',resolved:'Завершено',date:'Дата',deleteNotice:'Архівування після повернення авто, фінансовий облік і видалення облікового запису будуть реалізовані в наступних серверних міграціях.',noPayments:'АЗС і Fuel Points ще вимкнені. Оплата готівкою/переказом — лише після підтвердження власником.',authWait:'Перевірте електронну пошту для підтвердження, якщо це вимагають налаштування Supabase.',loginHint:'Електронна пошта, Google або Apple. Провайдери Google/Apple запрацюють лише після налаштування в Supabase.',onlyPilot:'ТЕСТОВИЙ ПІЛОТ · Не завантажуйте справжні документи до завершення аудиту доступу',retry:'Оновити',lang:'Мова',empty:'Немає даних',you:'Ви',driverProfile:'Профіль водія',allRequests:'Заявки всіх водіїв',myRequests:'Мої заявки',carPrice:'грн/доба',newCar:'Новий автомобіль',helper:'Помічник',reload:'Оновити',emailSent:'Лист відправлено, якщо адресу зареєстровано',soon:'Модуль буде перенесено після серверних тестів',cancelSos:'Скасувати SOS',notApproved:'Доступ до чату й SOS можливий лише для активних водіїв.',notFound:'Профіль не знайдено. Перевірте тригер реєстрації.',accountState:'Обліковий запис',logout:'Вийти',systemError:'Помилка сервера',docsTitle:'Документи водія',docsInfo:'Завантажте фото сторінок 1, 2, 3 паспорта, ІПН та підписаного договору оренди на обране авто. Усі 5 фото обов’язкові перед надсиланням заявки.',docsPrivacy:'Файли приватні: доступ маєте лише ви та власник NikCar. Не надсилайте їх у загальний чат.',passport_1:'Паспорт — сторінка 1',passport_2:'Паспорт — сторінка 2',passport_3:'Паспорт — сторінка 3',tax_id:'ІПН / РНОКПП',rental_contract:'Фото підписаного договору оренди',docsDone:'Документи додані',docsMissing:'Завантажте всі 5 фото перед заявкою',upload:'Завантажити фото',openDocument:'Переглянути',chooseCar:'Обрати авто',selectFirst:'Спочатку виберіть автомобіль',submitCar:'Завершити вибір і надіслати заявку',selectedCar:'Вибраний автомобіль',docsWaiting:'Потрібні документи',docLimit:'Максимальний розмір фото — 6 МБ. Дозволені JPG, PNG, WebP.',docUploadDone:'Документ збережено',docOwnerView:'Документи водіїв',docOwnerNote:'Лише власник може переглядати документи інших водіїв. Перевіряйте відповідність документів до видачі авто.'},
 en:{cars:'Fleet',requests:'Requests',chat:'Chat',sos:'SOS',documents:'Documents',account:'Account',signout:'Sign out',signin:'Sign in',signup:'Sign up',reset:'Reset password',email:'Email',password:'Password',fullname:'Full name',create:'Create account',login:'Sign in to NikCar',google:'Continue with Google',apple:'Continue with Apple',forgot:'Forgot password?',registerInfo:'Choose a car, upload all five documents, then send your request to the owner.',notConnected:'Cloud server is not connected yet',setup:'Fill web/config.js with your Supabase TEST project URL and publishable key, then apply the SQL migration. Do not enter real financial or personal data before an RLS audit.',cloudPilot:'Cloud pilot',role:'Role',access:'Access',candidate:'Candidate',active:'Active',archived:'Archived',blocked:'Blocked',owner:'Owner',driver:'Driver',free:'Available',reserved:'Reserved',rented:'Rented',maintenance:'Maintenance',model:'Model',plate:'Plate',year:'Year',rate:'Daily rate',saveCar:'Add vehicle',apply:'Request vehicle',approve:'Approve',reject:'Reject',cancel:'Cancel',pending:'Pending',approved:'Approved',rejected:'Rejected',cancelled:'Cancelled',requestTitle:'Rental requests',requestInfo:'Approving a request does NOT hand over a vehicle; photo inspection and key handover are not connected yet.',noRequests:'No requests yet',noCars:'No vehicles yet',unknown:'Unknown',saveProfile:'Save profile',phone:'Phone',chatTitle:'Fleet group chat',chatInfo:'Only active drivers and the owner can access. Private photo/video storage will follow.',message:'Message',send:'Send',noChat:'No messages yet',restricted:'Access opens only after a vehicle has actually been handed over.',sosTitle:'Driver mutual assistance',sosInfo:'Drivers claim SOS calls themselves; the owner does not assign helpers.',sosType:'Help needed',jump_start:'Jump start',tow:'Tow / recovery',wheel:'Flat tire',other:'Other',location:'Location or landmark',description:'Problem details',createSos:'Send SOS',claim:'I can help',release:'Cannot help',complete:'Help completed',noSos:'No SOS requests yet',open:'Awaiting help',claimed:'Help on the way',resolved:'Resolved',date:'Date',deleteNotice:'Archiving on car return, financial records and account-deletion requests will be added in the next reviewed server migrations.',noPayments:'Fuel station and Fuel Points are disabled. Cash/card payment reports need owner confirmation.',authWait:'Check email to confirm registration if required by your Supabase settings.',loginHint:'Email, Google or Apple. Google/Apple require setup in Supabase before they will work.',onlyPilot:'TEST PILOT · Do not upload real identity documents until access controls are audited',retry:'Refresh',lang:'Language',empty:'No data',you:'You',driverProfile:'Driver profile',allRequests:'All requests',myRequests:'My requests',carPrice:'UAH/day',newCar:'New vehicle',helper:'Helper',reload:'Refresh',emailSent:'Email sent if the account exists',soon:'This module will move after server tests',cancelSos:'Cancel SOS',notApproved:'Chat and SOS are for active drivers only.',notFound:'Profile missing. Check your registration trigger.',accountState:'Account',logout:'Sign out',systemError:'Server error',docsTitle:'Driver documents',docsInfo:'Upload photos of passport pages 1, 2, 3, tax ID and the signed rental agreement for the selected car. All five photos are required before submitting a request.',docsPrivacy:'Private files: only you and NikCar’s owner can access them. Never share identity documents in group chat.',passport_1:'Passport — page 1',passport_2:'Passport — page 2',passport_3:'Passport — page 3',tax_id:'Tax identification number',rental_contract:'Photo of signed rental agreement',docsDone:'Documents saved',docsMissing:'Upload all five photos before applying',upload:'Upload photo',openDocument:'View',chooseCar:'Choose car',selectFirst:'First select a car',submitCar:'Complete vehicle selection and apply',selectedCar:'Selected car',docsWaiting:'Documents required',docLimit:'Maximum photo size: 6 MB. JPG, PNG, WebP only.',docUploadDone:'Document saved',docOwnerView:'Driver documents',docOwnerNote:'Only the owner may inspect other drivers’ documents. Review them before handing over the car.'}
};
let selectedCar=null, docBusy=false, lastAuthEmail='';
let lang=(localStorage.getItem('nikcar-lang')==='en'?'en':'uk'),page='cars',mode='signin',authMethod='password',authNotice=initialLinkError?initialLinkErrorMessage():'',recoveryMode=!initialLinkError&&(initialRecoveryLink||readRecoveryPending());
const themeStorageKey='nikcar-theme';
// NikCar Service visual identity: acid-lime, white and black; existing auth/finance flows unchanged.
let theme=(()=>{try{return localStorage.getItem(themeStorageKey)==='dark'?'dark':'light';}catch(_){return 'light';}})();
document.documentElement.dataset.theme=theme;
function themeLabel(){return theme==='dark'?(lang==='uk'?'Світла тема':'Light theme'):(lang==='uk'?'Темна тема':'Dark theme');}
function themeIcon(){
 return theme==='dark'
  ?'<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>'
  :'<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 14.1A8.5 8.5 0 0 1 9.9 3.2 8.5 8.5 0 1 0 20.8 14.1Z"/></svg>';
}
function themeControl(){return `<button type="button" class="theme-toggle" data-action="toggle-theme" aria-pressed="${theme==='dark'}" aria-label="${themeLabel()}" title="${themeLabel()}">${themeIcon()}</button>`;}
function headerControls(){return `<div class="header-controls">${themeControl()}${langControl()}</div>`;}
function applyTheme(next){
 theme=next==='dark'?'dark':'light';
 document.documentElement.dataset.theme=theme;
 try{localStorage.setItem(themeStorageKey,theme);}catch(_){}
 const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.setAttribute('content',theme==='dark'?'#101116':'#FFFFFF');
 for(const button of document.querySelectorAll('[data-action="toggle-theme"]')){
  button.innerHTML=themeIcon();button.setAttribute('aria-pressed',String(theme==='dark'));
  button.setAttribute('aria-label',themeLabel());button.setAttribute('title',themeLabel());
 }
}
if(initialLinkError)persistRecoveryPending(false);
if(initialRecoveryLink)persistRecoveryPending(true);
let authNoticeIsError=Boolean(initialLinkError);
function setRecoveryMode(value){recoveryMode=Boolean(value);persistRecoveryPending(recoveryMode);}
const UICONSOLE={
 uk:{dashboard:'Огляд',drivers:'Водії',announcements:'Оголошення',dashboardTitle:'Панель власника',driversTitle:'Водії автопарку',addNews:'Опублікувати оголошення',newsTitleUa:'Заголовок українською',newsTitleEn:'Title in English',newsBodyUa:'Текст українською',newsBodyEn:'Message in English',pin:'Закріпити вгорі',newsFeed:'Новини автопарку',removeNews:'Видалити',fuelOff:'АЗС / Fuel Points — незабаром',fuelNotice:'Заправка та Fuel Points поки не працюють. Запуск — у наступних оновленнях.',carEdit:'Редагувати',saveChanges:'Зберегти зміни',cancelEdit:'Скасувати',noDrivers:'Немає зареєстрованих водіїв',driverSearch:'Пошук за ім’ям або телефоном',applyAccess:'Змінити статус',confirmChange:'Змінити доступ водія?',countCars:'Автомобілі',countDrivers:'Водії',countPending:'Нові заявки',countSOS:'Активні SOS',summaryInfo:'Живі дані автопарку. Оплата за заявкою власника активна у пілоті; передача/повернення авто ще не підключені.',releaseSoon:'У розробці',driverStatusHint:'Блокування/архівування заборонене, якщо є незавершені заявки чи бронювання. Фінансову історію не видаляємо.',copyText:'Копіювати для групи',emptyNews:'Оголошень ще немає',ownerGreeting:'Власник автопарку',noticeRequired:'Пілот: не використовуйте справжні документи до завершення перевірок.'},
 en:{dashboard:'Overview',drivers:'Drivers',announcements:'Announcements',dashboardTitle:'Owner dashboard',driversTitle:'Fleet drivers',addNews:'Publish announcement',newsTitleUa:'Ukrainian heading',newsTitleEn:'English heading',newsBodyUa:'Ukrainian text',newsBodyEn:'English text',pin:'Pin on top',newsFeed:'Fleet updates',removeNews:'Remove',fuelOff:'Fuel station / Fuel Points — coming soon',fuelNotice:'Fuel station and Fuel Points are not active. Planned for a future update.',carEdit:'Edit',saveChanges:'Save changes',cancelEdit:'Cancel',noDrivers:'No registered drivers',driverSearch:'Search by name or phone',applyAccess:'Change status',confirmChange:'Change driver access?',countCars:'Vehicles',countDrivers:'Drivers',countPending:'New requests',countSOS:'Active SOS',summaryInfo:'Live fleet data. Manual payment claims and owner receipts are available in pilot mode; handover/returns are not yet connected.',releaseSoon:'Under development',driverStatusHint:'Archiving/blocking requires resolved rental requests. Existing history is retained.',copyText:'Copy for group',emptyNews:'No announcements yet',ownerGreeting:'Fleet owner',noticeRequired:'Pilot: do not use real identity documents until security checks are completed.'}
};

const ADDITIONS={
 uk:{payments:'Платежі',paymentTitle:'Оплата оренди',paymentHint:'Натиснувши «Оплатив», ви лише повідомляєте власника. Платіж зараховується тільки після його підтвердження.',paymentsOwnerHint:'Тільки після фактичного отримання грошей підтвердьте платіж. Натискання водія не означає надходження.',paymentMethod:'Спосіб оплати',cash:'Готівкою',card_transfer:'Переказом на картку',amount:'Сума, ₴',paidClaim:'Оплатив — повідомити власника',confirmPayment:'Підтвердити отримання',rejectPayment:'Відхилити платіж',declared:'Очікує підтвердження',confirmed:'Підтверджено власником',paymentNote:'Примітка',noApprovedRental:'Немає схвалених заявок для повідомлення про оплату.',paymentChooseRental:'Виберіть оренду',paymentNoData:'Платежів поки немає',noReceiptYet:'Не зараховано: власник ще не підтвердив отримання грошей.',paymentsStatus:'Облік оплати у тестовому режимі: підтверджуйте лише реально отримані кошти.',repairs:'Ремонти',repairTitle:'Кошториси ремонтів',repairCar:'Автомобіль',repairName:'Назва ремонту',repairVIN:'VIN (17 символів)',repairSymptoms:'Несправність / потрібні деталі',repairLabor:'Вартість робіт, ₴',repairCreate:'Створити кошторис',repairParts:'Запчастини',repairSelect:'Виберіть кошторис',repairPartName:'Найменування',repairArticle:'Артикул',repairQty:'Кількість',repairPrice:'Ціна за одиницю, ₴',repairSupplier:'Постачальник',repairUrl:'Посилання на товар (https://)',repairAdd:'Додати позицію',repairPost:'Завершити ремонт і записати у витрати',repairDraft:'Чернетка',repairPosted:'У витратах',repairTotal:'Загальна сума',repairNoData:'Кошторисів немає',repairLink:'Відкрити товар',repairDelete:'Прибрати',repairPostedWarn:'Після запису у витрати кошторис стає незмінним.',repairAi:'Розумний помічник NikCar',repairAiInfo:'Локальні підказки за ключовими словами, не діагностика ШІ. Перевірте запчастини за VIN у каталозі постачальника перед купівлею.',repairSuggestions:'Орієнтовні категорії деталей',repairVoice:'🎙 Голосовий ввід',repairVoiceUnavailable:'Голосовий ввід не підтримується цим браузером. Введіть текст вручну.',repairSearch:'Перейти до каталогу Inter Cars',repairSource:'Ціни поки вводяться вручну. API Inter Cars потребує окремої активації; пароль у браузері не зберігається.',authConfirm:'Підтвердження адреси',authConfirmHelp:'Після реєстрації відкрийте лист від Supabase та натисніть посилання підтвердження, потім поверніться до NikCar.',authResend:'Надіслати лист підтвердження повторно',authPasswordNew:'Створіть новий пароль',authPasswordSave:'Зберегти новий пароль',authRecoverTitle:'Встановлення нового пароля',authRecoverDone:'Пароль успішно змінено. Увійдіть з новим паролем.',oauthNotReady:'Вхід через цей сервіс вимагає налаштування Google/Apple у Supabase. Використайте email, доки інтеграцію не активовано.',oauthInfo:'Google/Apple доступні лише після налаштування OAuth у Supabase.',pendingFeature:'Автоматичний підбір запчастин і ціни Inter Cars додамо після підтвердженого API-доступу.'},
 en:{payments:'Payments',paymentTitle:'Rental payments',paymentHint:'Tapping “I paid” only notifies the owner. A payment is recorded as received only after owner confirmation.',paymentsOwnerHint:'Confirm a payment only after you actually receive the money. A driver claim is not a receipt.',paymentMethod:'Payment method',cash:'Cash',card_transfer:'Card transfer',amount:'Amount, UAH',paidClaim:'I paid — notify owner',confirmPayment:'Confirm receipt',rejectPayment:'Reject claim',declared:'Awaiting owner confirmation',confirmed:'Owner confirmed',paymentNote:'Note',noApprovedRental:'No approved rentals for payment reports.',paymentChooseRental:'Select rental',paymentNoData:'No payments yet',noReceiptYet:'Not recorded: owner has not confirmed receiving money.',paymentsStatus:'Payment tracking is in pilot mode: confirm only funds actually received.',repairs:'Repairs',repairTitle:'Repair estimates',repairCar:'Vehicle',repairName:'Repair title',repairVIN:'VIN (17 characters)',repairSymptoms:'Symptoms / required parts',repairLabor:'Labor cost, UAH',repairCreate:'Create estimate',repairParts:'Parts',repairSelect:'Select estimate',repairPartName:'Part name',repairArticle:'Part number',repairQty:'Quantity',repairPrice:'Unit price, UAH',repairSupplier:'Supplier',repairUrl:'Product link (https://)',repairAdd:'Add part',repairPost:'Finalize repair and book expense',repairDraft:'Draft',repairPosted:'Posted as expense',repairTotal:'Total',repairNoData:'No repair estimates',repairLink:'Open item',repairDelete:'Remove',repairPostedWarn:'Once posted, a repair estimate is immutable.',repairAi:'NikCar smart helper',repairAiInfo:'Local keyword suggestions, not AI diagnosis. Verify all parts against the vehicle VIN in supplier catalogue.',repairSuggestions:'Potential parts categories',repairVoice:'🎙 Voice input',repairVoiceUnavailable:'Voice input is not supported by this browser. Please type manually.',repairSearch:'Open Inter Cars catalogue',repairSource:'Prices must be entered manually. Inter Cars API requires separate activation; your supplier password is not saved in the browser.',authConfirm:'Confirm your email',authConfirmHelp:'After registration, open the Supabase email and click confirmation link, then return to NikCar.',authResend:'Resend confirmation email',authPasswordNew:'Choose a new password',authPasswordSave:'Save new password',authRecoverTitle:'Set a new password',authRecoverDone:'Password changed. Sign in with your new password.',oauthNotReady:'This provider requires Google/Apple configuration in Supabase. Use email login until it is enabled.',oauthInfo:'Google/Apple work only after configuring the OAuth providers in Supabase.',pendingFeature:'Automatic Inter Cars price lookup will follow once API access is activated.'}
};
const t=k=>ADDITIONS[lang]?.[k]||UICONSOLE[lang]?.[k]||TRANSLATIONS[lang][k]||k;
const e=s=>String(s??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const d=x=>x?new Date(x).toLocaleString(lang==='uk'?'uk-UA':'en-GB',{dateStyle:'short',timeStyle:'short'}):'—';
const money=x=>Number(x||0).toLocaleString(lang==='uk'?'uk-UA':'en-GB')+' ₴';
const emptyRecords=()=>({cars:[],rental_requests:[],chat_messages:[],sos_requests:[],profiles:[],driver_documents:[],announcements:[],payment_claims:[],repair_jobs:[],repair_parts:[],expense_entries:[],fleet_service_events:[],fleet_files:[],fleet_inspections:[],fleet_damage_reviews:[]});
let sb=null,user=null,me=null,records=emptyRecords();
const driverTabs=[['cars','🚙'],['announcements','◉'],['requests','▤'],['payments','₴'],['documents','📄'],['chat','💬'],['sos','🆘'],['account','◯']];
const ownerTabs=[['dashboard','⌂'],['nikcar-ai','✦'],['cars','🚙'],['drivers','♙'],['requests','▤'],['payments','₴'],['repairs','⚒'],['documents','📄'],['announcements','◉'],['chat','💬'],['sos','🆘'],['account','◯']];
const tabsForRole=()=>isOwner()?ownerTabs:driverTabs;
let carEditor=null;let sessionInitialized=false;let showMore=false;let currentRepair=null;
let selectedDriverId=null,currentAuthUserId=null,loadVersion=0,lastForegroundRefresh=0;
let forceMutationRefresh=0;
// Keep user-entered data intact while background Realtime/visibility updates arrive.
function hasUnsavedForm(){return !!document.querySelector('form[data-dirty="1"],form[data-submitting="1"]');}
const inFlightActions=new Set();
const actionGroups={
 'confirm-payment':'payment','reject-payment':'payment',
 'approve-request':'rental','reject-request':'rental','cancel-request':'rental',
 'claim-sos':'sos','release-sos':'sos','finish-sos':'sos','cancel-sos':'sos'
};
const protectedActions=new Set([
 'signout','resend-confirm','submit-doc-choice','open-doc',
 'approve-request','reject-request','cancel-request',
 'confirm-payment','reject-payment','post-repair','remove-part',
 'set-driver-access','delete-announcement',
 'claim-sos','release-sos','finish-sos','cancel-sos'
]);
function clearAccountState(){
 loadVersion++;forceMutationRefresh=0;me=null;records=emptyRecords();selectedCar=null;selectedDriverId=null;carEditor=null;currentRepair=null;
 sessionInitialized=false;showMore=false;page='cars';lastAuthEmail='';
 if(typeof ownerUiDrafts!=='undefined')ownerUiDrafts.clear();
 mode='signin';authMethod='password';authNotice='';authNoticeIsError=false;
}
function refreshWhenVisible(){
 if(document.visibilityState==='hidden'||!sb||!user||recoveryMode)return;
 const now=Date.now();
 if(now-lastForegroundRefresh<12000)return;
 lastForegroundRefresh=now;void load({preserveDraft:true});
}
window.addEventListener('focus',refreshWhenVisible);
document.addEventListener('visibilitychange',refreshWhenVisible);
// The network notice lives outside #root, so connectivity events never wipe typed forms.
const networkStatus=document.getElementById('network-status');
function isOffline(){return typeof navigator!=='undefined'&&navigator.onLine===false;}
function offlineMessage(){return lang==='uk'?'Немає інтернету. Дані не будуть надіслані, доки з’єднання не відновиться.':'No internet connection. Changes cannot be sent until connection returns.';}
function updateNetworkStatus(){
 if(!networkStatus)return;
 networkStatus.hidden=!isOffline();
 networkStatus.textContent=isOffline()?offlineMessage():'';
}
window.addEventListener('offline',updateNetworkStatus);
window.addEventListener('online',()=>{updateNetworkStatus();if(user&&!recoveryMode)void load({preserveDraft:true});});
updateNetworkStatus();
function toast(msg){const n=document.getElementById('toast');n.textContent=String(msg);n.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>n.classList.remove('show'),4300)}
function status(s){const v=['rejected','cancelled','blocked'].includes(s)?'danger':['pending','claimed','candidate','declared'].includes(s)?'warn':'';return `<span class="tag ${v}">${e(t(s||'unknown'))}</span>`}
function profile(id){return records.profiles.find(x=>x.id===id)}
function name(id){return profile(id)?.full_name||t('unknown')}
function carName(id){const v=records.cars.find(x=>x.id===id);return v?`${v.model} · ${v.plate}`:t('unknown')}
function isOwner(){return me?.role==='owner'&&me.access==='active'}
function activeMember(){return isOwner()||(me?.role==='driver'&&me.access==='active')}
function canApply(){return me?.role==='driver'&&['candidate','active'].includes(me.access)}
function configuredPage(){return `<div class="auth-layout"><div class="auth-box"><div class="row"><div class="brand"><img class="brand-mark" src="./icon.svg" alt="" width="42" height="42"><span class="brand-copy">Nik<em>Car</em><small>SERVICE · FLEET</small></span></div>${headerControls()}</div><h1>${t('notConnected')}</h1><p>${t('setup')}</p><div class="banner warning">${t('onlyPilot')}</div></div></div>`}
function langControl(){return `<select class="lang" data-action="language" aria-label="${t('lang')}"><option value="uk" ${lang==='uk'?'selected':''}>UA</option><option value="en" ${lang==='en'?'selected':''}>EN</option></select>`}
function navIcon(id){
 const paths={
 'nikcar-ai':'<path d="m12 2 2.3 7.7L22 12l-7.7 2.3L12 22l-2.3-7.7L2 12l7.7-2.3Z"/>',
 dashboard:'<rect x="3" y="3" width="7" height="7" rx="1.2"/><rect x="14" y="3" width="7" height="7" rx="1.2"/><rect x="3" y="14" width="7" height="7" rx="1.2"/><rect x="14" y="14" width="7" height="7" rx="1.2"/>',
 cars:'<path d="m5 17-1 3m15-3 1 3M5 17h14a2 2 0 0 0 2-2v-3l-2.5-6.5A2 2 0 0 0 16.6 4H7.4a2 2 0 0 0-1.9 1.5L3 12v3a2 2 0 0 0 2 2Z"/><path d="M3 12h18"/><path d="M7 14h.01M17 14h.01"/>',
 drivers:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
 requests:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3v2h6V3M9 10h6M9 14h6M9 18h4"/>',
 payments:'<rect x="2" y="5" width="20" height="15" rx="2"/><path d="M2 10h20M16 15h2"/>',
 repairs:'<path d="M14.7 6.3a5 5 0 0 0-6.4 6.4L3 17.6a2.4 2.4 0 1 0 3.4 3.4l5.3-5.3a5 5 0 0 0 6.4-6.4l-3.4 3.4-3.4-3.4z"/>',
 documents:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>',
 announcements:'<path d="m3 11 18-5v12L3 13z"/><path d="m7 14 2 6h4l-2-7M21 8a4 4 0 0 1 0 8"/>',
 chat:'<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8A8.5 8.5 0 0 1 12.5 20a8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 12.5 3a8.5 8.5 0 0 1 8.5 8.5z"/>',
 sos:'<circle cx="12" cy="12" r="10"/><path d="M12 7v6M12 17h.01"/>',
 account:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>'
 };
 return '<svg aria-hidden="true" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+(paths[id]||paths.dashboard)+'</svg>';
}
function authPage(){
 const recovering=recoveryMode&&!!user;
 const head=recovering?t('authRecoverTitle'):(mode==='signup'?t('signup'):mode==='reset'?t('reset'):t('login'));
 const magic=mode==='signin'&&authMethod==='magic';
 const form=recovering?`<form id="new-password-form" class="form"><label class="field">${t('authPasswordNew')}<input type="password" name="password" minlength="10" maxlength="128" autocomplete="new-password" required></label><label class="field">${lang==='uk'?'Повторіть новий пароль':'Confirm new password'}<input type="password" name="confirm_password" minlength="10" maxlength="128" autocomplete="new-password" required></label><button type="submit" class="btn full">${t('authPasswordSave')}</button><button type="button" class="btn secondary full" data-action="cancel-recovery">${lang==='uk'?'Скасувати':'Cancel'}</button><button type="button" class="btn secondary full" data-action="signout">${lang==='uk'?'Вийти з акаунта':'Sign out'}</button></form>`:`<form id="auth-form" class="form">${mode==='signup'?`<label class="field">${t('fullname')}<input name="fullname" required maxlength="150" autocomplete="name"></label>`:''}<label class="field">${t('email')}<input type="email" name="email" autocomplete="email" required value="${e(lastAuthEmail)}"></label>${mode==='reset'||magic?'':`<label class="field">${t('password')}<input type="password" name="password" ${mode==='signup'?'minlength="10" maxlength="128"':''} required autocomplete="${mode==='signup'?'new-password':'current-password'}"></label>${mode==='signup'?`<label class="field">${lang==='uk'?'Повторіть пароль':'Confirm password'}<input type="password" name="confirm_password" minlength="10" maxlength="128" autocomplete="new-password" required></label>`:''}`}<button type="submit" class="btn full">${mode==='signup'?t('create'):mode==='reset'?t('reset'):magic?(lang==='uk'?'Отримати посилання на email':'Send a sign-in link'):t('signin')}</button></form>`;

 const visualTitle=lang==='uk'?'Ваш автопарк. Під вашим контролем.':'Your fleet. Your control.';
 const visualText=lang==='uk'?'Автомобілі, водії, заявки та платежі — в одному зручному кабінеті NikCar.':'Vehicles, drivers, requests and payments — in one clear NikCar workspace.';
 const authSubtitle=recovering?(lang==='uk'?'Оновіть пароль, щоб повернути доступ.':'Set a new password to regain access.'):(mode==='signup'?(lang==='uk'?'Створіть обліковий запис для роботи з автопарком.':'Create an account to use NikCar Fleet Control.'):(mode==='reset'?(lang==='uk'?'Вкажіть email — надішлемо лист для відновлення.':'Enter your email to receive a recovery link.'):(lang==='uk'?'Раді вас бачити. Увійдіть до свого кабінету.':'Welcome back. Sign in to your workspace.')));
 const providers=[
  {id:'google',title:'Google',mark:'G',type:'google'},
  {id:'apple',title:'Apple',mark:'●',type:'apple'},
  {id:'azure',title:'Microsoft',mark:'▦',type:'microsoft'},
  {id:'github',title:'GitHub',mark:'GH',type:'github'}
 ];
 const providerCards=providers.filter(p=>oauthEnabled[p.id]===true).map(p=>`<button type="button" class="sso-option" data-action="oauth" data-provider="${p.id}" aria-label="${lang==='uk'?'Продовжити через':'Continue with'} ${p.title}"><span class="sso-mark sso-${p.type}" aria-hidden="true">${p.mark}</span><span>${p.title}</span><span class="sso-available" aria-hidden="true">↗</span></button>`).join('');
 const socials=providerCards?`<div class="sso-section"><div class="sso-divider"><span>${lang==='uk'?'Продовжити через':'Continue with'}</span></div><div class="sso-grid">${providerCards}</div></div>`:'';
 const methodTabs=!recovering&&mode==='signin'?`<div class="auth-compact-link" role="group" aria-label="${lang==='uk'?'Оберіть спосіб входу':'Choose sign-in method'}"><button type="button" class="auth-small-link ${authMethod==='password'?'active':''}" data-action="auth-small-link" data-value="password">${lang==='uk'?'Пароль':'Password'}</button><button type="button" class="auth-small-link ${authMethod==='magic'?'active':''}" data-action="auth-small-link" data-value="magic">${lang==='uk'?'Посилання на email':'Email link'}</button></div>`:'';

 return `<div class="auth-layout v09-auth">
  <aside class="auth-visual" aria-label="${lang==='uk'?'Ілюстрація NikCar':'NikCar illustration'}">
    <div class="auth-visual-top"><span class="auth-visual-brand">NIKCAR / FLEET</span><span class="pilot-chip">${lang==='uk'?'ТЕСТОВА ВЕРСІЯ':'PILOT VERSION'}</span></div>
    <div class="auth-visual-graphic"><img src="./fleet-hero.svg" alt="${lang==='uk'?'Векторна ілюстрація автомобіля NikCar':'Vector illustration of a NikCar vehicle'}" width="750" height="530"></div>
    <div class="auth-visual-bottom"><span class="eyebrow">${lang==='uk'?'РОЗУМНЕ УПРАВЛІННЯ':'SMART FLEET CONTROL'}</span><h2>${visualTitle}</h2><p>${visualText}</p></div>
  </aside>
  <section class="auth-box">
    <div class="auth-header"><div class="brand"><img class="brand-mark" src="./icon.svg" alt="" width="42" height="42"><span class="brand-copy">Nik<em>Car</em><small>SERVICE · FLEET</small></span></div>${headerControls()}</div>
    <div class="auth-intro"><span class="eyebrow">${lang==='uk'?'КАБІНЕТ NIKCAR':'NIKCAR PORTAL'}</span><h1>${head}</h1><p>${authSubtitle}</p></div>
    ${authNotice?`<div class="banner${authNoticeIsError?' warning':''}" role="${authNoticeIsError?'alert':'status'}">${e(authNotice)}</div>`:''}
    ${!recovering&&mode!=='reset'?`<div class="auth-tabs" role="group" aria-label="${lang==='uk'?'Вхід або реєстрація':'Sign in or register'}"><button type="button" class="auth-tab ${mode==='signin'?'active':''}" data-action="auth-mode" data-value="signin">${t('signin')}</button><button type="button" class="auth-tab ${mode==='signup'?'active':''}" data-action="auth-mode" data-value="signup">${t('signup')}</button></div>`:''}
    ${form}
    ${methodTabs}
    ${magic?`<p class="magic-hint">${lang==='uk'?'Надішлемо одноразове посилання тільки для вже зареєстрованого акаунта.':'We will send a one-time link for existing accounts only.'}</p>`:''}
    ${recovering?'':`<div class="auth-helper">${mode==='reset'?`<button type="button" class="btn" data-action="auth-mode" data-value="signin">${t('signin')}</button>`:`<button type="button" class="btn" data-action="auth-mode" data-value="reset">${t('forgot')}</button>`}</div>
    ${mode==='reset'?'':`<details class="auth-info"><summary>${lang==='uk'?'Не отримали лист для підтвердження?':'Did not receive your confirmation email?'}</summary><p>${t('authConfirmHelp')}</p><button type="button" class="btn secondary tiny" data-action="resend-confirm">${t('authResend')}</button></details>`}
    ${mode==='signin'?socials:''}`}
    <div class="auth-footer-note">${t('onlyPilot')}</div>
  </section>
 </div>`;
}
function layout(body,title){
 const tabs=tabsForRole();
 const nav=tabs.map(([id,icon])=>`<button data-action="nav" data-page="${id}" class="${id===page?'active':''}"><span class="nav-symbol">${navIcon(id)}</span> ${id==='nikcar-ai'?'NikCar AI':t(id)}</button>`).join('');
 const visibleMobile=(isOwner()?['dashboard','cars','nikcar-ai','payments','requests']:['cars','announcements','requests','payments','sos']);
 const mobile=tabs.filter(([id])=>visibleMobile.includes(id)).map(([id,icon])=>`<button data-action="nav" data-page="${id}" class="${id===page?'active':''}"><span>${navIcon(id)}</span><span>${id==='nikcar-ai'?'NikCar AI':t(id)}</span></button>`).join('')+`<button data-action="more" class="${showMore?'active':''}"><span>⋯</span><span>${lang==='uk'?'Ще':'More'}</span></button>`;
 const moreMenu=showMore?`<div class="more-overlay"><div class="more-sheet"><h2>${lang==='uk'?'Усі розділи':'All sections'}</h2>${tabs.filter(([id])=>!visibleMobile.includes(id)).map(([id,icon])=>`<button data-action="nav" data-page="${id}"><span>${navIcon(id)}</span>${id==='nikcar-ai'?'NikCar AI':t(id)}</button>`).join('')}<button class="btn secondary" data-action="more">${t('cancel')}</button></div></div>`:'';return `<div class="shell"><aside class="sidebar"><div class="brand"><img class="brand-mark" src="./icon.svg" alt="" width="42" height="42"><span class="brand-copy">Nik<em>Car</em><small>SERVICE · FLEET</small></span></div><div class="sidebar-kicker">${e(isOwner()?t('ownerGreeting'):t('driverProfile'))}</div><nav class="nav">${nav}</nav><div class="sidehint">${t('onlyPilot')}</div></aside><div class="workspace"><header class="top"><div class="brand"><img class="brand-mark" src="./icon.svg" alt="" width="42" height="42"><span class="brand-copy">Nik<em>Car</em><small>SERVICE · FLEET</small></span></div><div class="right"><span class="small desktop-label">${e(me.full_name||user?.email||'')}</span>${status(me.access)} ${headerControls()}</div></header><main class="main"><div class="subtitle">NIKCAR · CLOUD CONSOLE 0.12</div><h1>${title}</h1>${body}</main></div><nav class="mobilebar">${mobile}</nav>${moreMenu}</div>`;
}
// Fleet Intelligence v1: owner-only financial estimates from already loaded records.
// Incomplete expenses or unconfirmed payments must never be labelled audited profit.
function fleetIntelligencePage(){
 if(!isOwner())return '';
 const costs=records.expense_entries.filter(x=>Number.isFinite(Number(x.amount))&&Number(x.amount)>=0);
 const paid=records.payment_claims.filter(x=>x.status==='confirmed'&&Number.isFinite(Number(x.amount))&&Number(x.amount)>=0);
 const byCar=new Map(records.cars.map(c=>[c.id,{car:c,cost:0,revenue:0,items:[]}]));
 for(const x of costs){const row=byCar.get(x.car_id);if(row){row.cost+=Number(x.amount);row.items.push(x);}}
 for(const x of paid){
  const rent=records.rental_requests.find(r=>r.id===x.rental_request_id);
  const row=byCar.get(rent?.car_id);if(row)row.revenue+=Number(x.amount);
 }
 const rows=[...byCar.values()].map(x=>`<div class="line"><div><b>${e(x.car.model)} · ${e(x.car.plate)}</b><div class="small">Підтверджені платежі: ${money(x.revenue)} · Обліковані витрати: ${money(x.cost)}</div><div class="small">Різниця за доступними записами: <b>${money(x.revenue-x.cost)}</b></div></div></div>`).join('');
 const groups=new Map();
 for(const x of costs){const k=x.car_id||'fleet';if(!groups.has(k))groups.set(k,[]);groups.get(k).push(Number(x.amount));}
 const alerts=[];
 for(const x of costs){
  const sample=groups.get(x.car_id||'fleet')||[];
  const peers=sample.filter(v=>v!==Number(x.amount)).sort((a,b)=>a-b);
  if(peers.length<3)continue;
  const median=peers[Math.floor(peers.length/2)];
  if(median>0&&Number(x.amount)>=median*3&&Number(x.amount)-median>=1000)
   alerts.push(x);
 }
 const flagged=alerts.slice(0,8).map(x=>`<div class="line"><div><b>${money(x.amount)}</b> · ${e(x.category||'Витрата')}<div class="small">${e(carName(x.car_id))} · ${d(x.created_at)}</div></div></div>`).join('');
 return `<section class="card" aria-label="NikCar Fleet Intelligence"><h2>📊 NikCar Fleet Intelligence</h2><p class="small">Попередня аналітика за завантаженими записами (до 250 платежів і 200 витрат). Це не бухгалтерський прибуток: не враховано непроведені витрати, податки та амортизацію.</p><h3>Доходи та витрати за авто</h3>${rows||'<p class="small">Додайте автомобіль для аналітики.</p>'}<h3>Незвичайні витрати</h3><p class="small">Сигнал, якщо сума в 3+ рази перевищує типову за тим самим авто (мінімум 3 інші записи) та різниця становить від 1000 грн. Це не доказ помилки.</p>${flagged||'<p class="small">За наявними записами підозрілих сум не виявлено або даних замало.</p>'}</section>`;
}
function fleetServicePage(){
 if(!isOwner())return '';
 const opts=records.cars.map(c=>`<option value="${e(c.id)}">${e(c.model)} · ${e(c.plate)}</option>`).join('');
 const today=new Date();today.setHours(0,0,0,0);
 const events=(records.fleet_service_events||[]).slice().sort((a,b)=>(a.completed_at?1:0)-(b.completed_at?1:0)||String(a.due_date||'9999').localeCompare(String(b.due_date||'9999')));
 const rows=events.map(x=>{
  const days=x.due_date?Math.round((new Date(x.due_date+'T12:00:00')-today)/86400000):null;
  const latestInspection=(records.fleet_inspections||[]).filter(z=>z.car_id===x.car_id&&z.odometer_km!=null).sort((a,b)=>String(b.inspected_at).localeCompare(String(a.inspected_at)))[0];
  const effectiveKm=Math.max(Number(x.current_odometer_km)||0,Number(latestInspection?.odometer_km)||0);
  const kmLeft=x.due_odometer_km!=null&&effectiveKm>0?x.due_odometer_km-effectiveKm:null;
  const urgent=!x.completed_at&&((days!==null&&days<=30)||(kmLeft!==null&&kmLeft<=1000));
  const tag=x.completed_at?'✓ Виконано':urgent?'⚠ Потребує уваги':'Заплановано';
  return `<div class="line"><div><b>${e(x.title)}</b> · ${e(carName(x.car_id))}<div class="small">${e(x.kind)} · ${x.due_date?e(x.due_date):'Без дати'}${x.due_odometer_km!=null?' · ТО на '+e(x.due_odometer_km)+' км':''} · ${tag}</div>${x.notes?'<div class="small">'+e(x.notes)+'</div>':''}</div>${!x.completed_at?`<button class="btn secondary tiny" data-action="service-done" data-id="${e(x.id)}">Виконано</button>`:''}</div>`;
 }).join('');
 return `<section class="card"><h2>🛠 Контроль автопарку</h2><p class="small">ТО, страхування, сезонна заміна шин і техогляди. Попередження видно в панелі власника за 30 днів або за 1000 км до терміну. Push-повідомлення ще не підключені.</p>${records.cars.length?`<form id="service-event" class="form"><label class="field">Автомобіль<select name="car_id" required>${opts}</select></label><label class="field">Тип<select name="kind"><option value="maintenance">ТО</option><option value="insurance">Страхування</option><option value="tires">Сезонні шини</option><option value="inspection">Техогляд</option></select></label><label class="field">Назва<input name="title" required minlength="2" maxlength="160" placeholder="Наприклад, ОСЦПВ або заміна оливи"></label><div class="row stack"><label class="field">Дата<input type="date" name="due_date"></label><label class="field">Пробіг для ТО, км<input type="number" min="0" name="due_odometer_km"></label><label class="field">Поточний пробіг, км<input type="number" min="0" name="current_odometer_km"></label></div><label class="field">Примітки<input name="notes" maxlength="1000"></label><button class="btn" type="submit">Додати нагадування</button></form>`:'<p>Спочатку додайте автомобіль.</p>'}<h3>Календар подій</h3>${rows||'<p class="small">Подій поки немає.</p>'}</section>`;
}
function fleetEvidencePage(){
 if(!isOwner())return '';
 const opts=records.cars.map(c=>`<option value="${e(c.id)}">${e(c.model)} · ${e(c.plate)}</option>`).join('');
 const stateOptions='<option value="unknown">Не перевірено</option><option value="ok">Норма</option><option value="attention">Потрібна увага</option><option value="critical">Критично</option>';
 const stateLabel={unknown:'Не перевірено',ok:'Норма',attention:'Потрібна увага',critical:'Критично'};
 const inspections=(records.fleet_inspections||[]).slice(0,20).map(x=>{
  const vals=['engine','brakes','tires','body'].map(k=>stateLabel[x[k]]||stateLabel.unknown);
  const overall=['critical','attention','ok','unknown'].find(k=>[x.engine,x.brakes,x.tires,x.body].includes(k))||'unknown';
  return `<div class="line"><div><b>${e(carName(x.car_id))}</b> · ${d(x.inspected_at)}<div class="small">Оцінка: ${e(stateLabel[overall])} · Двигун: ${e(vals[0])} · Гальма: ${e(vals[1])} · Шини: ${e(vals[2])} · Кузов: ${e(vals[3])}</div>${x.odometer_km!=null?'<div class="small">Пробіг: '+e(x.odometer_km)+' км</div>':''}${x.notes?'<div class="small">'+e(x.notes)+'</div>':''}</div></div>`;
 }).join('');
 const photoCount=(records.fleet_files||[]).filter(x=>['damage_photo','inspection_photo'].includes(x.kind)&&/\.(jpg|jpeg|png|webp)$/i.test(x.object_path)).length;
 const photoOptions=(records.fleet_files||[]).filter(x=>['damage_photo','inspection_photo'].includes(x.kind)&&/\.(jpg|jpeg|png|webp)$/i.test(x.object_path)).map(x=>`<option value="${e(x.id)}" data-car="${e(x.car_id)}">${e(carName(x.car_id))} · ${e(x.title)} · ${d(x.created_at)}</option>`).join('');
 const reviews=(records.fleet_damage_reviews||[]).slice(0,15).map(x=>{
  const result=x.result||{},findings=Array.isArray(result.possible_new_damage)?result.possible_new_damage:[];
  return `<div class="line"><div><b>${e(carName(x.car_id))}</b> · ${d(x.created_at)}<div class="small">${e(result.summary||'Без висновку')}</div><div class="small">Можливі пошкодження: ${findings.length} · ${x.owner_decision?e(x.owner_decision):'Очікує рішення власника'}</div>${findings.slice(0,5).map(z=>'<div class="small">'+e(z.area||'')+' · '+e(z.type||'')+' · '+e(z.evidence||'')+'</div>').join('')}</div>${!x.owner_decision?`<div class="actions"><button class="btn secondary tiny" data-action="damage-decision" data-id="${e(x.id)}" data-decision="needs_inspection">Огляд</button><button class="btn secondary tiny" data-action="damage-decision" data-id="${e(x.id)}" data-decision="accepted">Підтвердити</button><button class="btn secondary tiny" data-action="damage-decision" data-id="${e(x.id)}" data-decision="rejected">Відхилити</button></div>`:''}</div>`;
 }).join('');
 const files=(records.fleet_files||[]).slice(0,30).map(x=>`<div class="line"><div><b>${e(x.title)}</b> · ${e(carName(x.car_id))}<div class="small">${e(x.kind)} · ${d(x.created_at)}</div></div><button type="button" class="btn secondary tiny" data-action="fleet-open-file" data-id="${e(x.id)}">Відкрити</button></div>`).join('');
 return `<section class="card"><h2>📷 Огляди та документи автопарку</h2><p class="small">Захищене зберігання договорів, актів та фотографій. Фото можна додати для подальшого порівняння. ІІ-порівняння фото доступне після налаштування серверного AI-ключа. Висновки потребують перевірки власником.</p>${records.cars.length?`
 <form id="fleet-inspection-form" class="form"><h3>Технічний огляд</h3><label class="field">Автомобіль<select name="car_id" required>${opts}</select></label><label class="field">Пробіг, км<input type="number" min="0" name="odometer_km"></label><div class="row stack"><label class="field">Двигун<select name="engine">${stateOptions}</select></label><label class="field">Гальма<select name="brakes">${stateOptions}</select></label><label class="field">Шини<select name="tires">${stateOptions}</select></label><label class="field">Кузов<select name="body">${stateOptions}</select></label></div><label class="field">Зауваження<textarea name="notes" maxlength="2000"></textarea></label><button class="btn" type="submit">Зберегти огляд</button></form>
 <form id="fleet-file-form" class="form"><h3>Договір, акт або фото</h3><label class="field">Автомобіль<select name="car_id" required>${opts}</select></label><label class="field">Тип<select name="kind"><option value="contract">Договір</option><option value="handover_act">Акт видачі</option><option value="return_act">Акт повернення</option><option value="damage_photo">Фото пошкодження</option><option value="inspection_photo">Фото огляду</option><option value="other">Інше</option></select></label><label class="field">Назва<input name="title" required minlength="2" maxlength="160"></label><label class="field">Файл (JPG, PNG, WebP або PDF до 15 МБ)<input name="file" type="file" required accept="image/jpeg,image/png,image/webp,application/pdf"></label><button class="btn" type="submit">Завантажити захищено</button></form>`:'<p>Спочатку додайте автомобіль.</p>'}
 <h3>ІІ-порівняння фото</h3><p class="small">Оберіть фото ДО і ПІСЛЯ одного авто. ІІ може помилятися через ракурс, світло чи забруднення. Аналіз запускається лише після натискання кнопки та за наявності серверного ключа.</p>${photoCount>=2?`<form id="fleet-damage-ai-form" class="form"><label class="field">Фото ДО<select name="before_file_id" required>${photoOptions}</select></label><label class="field">Фото ПІСЛЯ<select name="after_file_id" required>${photoOptions}</select></label><button class="btn" type="submit">Порівняти фотографії</button></form>`:'<p class="small">Спочатку завантажте два фото огляду.</p>'}<h3>Висновки ІІ</h3>${reviews||'<p class="small">Порівнянь ще немає.</p>'}<h3>Історія оглядів</h3>${inspections||'<p class="small">Оглядів ще немає.</p>'}<h3>Архів файлів</h3>${files||'<p class="small">Файлів ще немає.</p>'}</section>`;
}
function fleetOverviewVisuals(){
 const cars=records.cars||[],requests=records.rental_requests||[],payments=records.payment_claims||[],expenses=records.expense_entries||[];
 const active=new Set(requests.filter(x=>['approved','active','in_progress'].includes(x.status)).map(x=>x.car_id));
 const busy=cars.filter(x=>active.has(x.id)).length,free=Math.max(0,cars.length-busy);
 const confirmed=payments.filter(x=>x.status==='confirmed').reduce((n,x)=>n+(Number(x.amount)||0),0);
 const costs=expenses.reduce((n,x)=>n+(Number(x.amount)||0),0);
 const total=Math.max(1,cars.length),pct=Math.round(busy/total*100);
 const moneyFmt=n=>new Intl.NumberFormat(lang==='uk'?'uk-UA':'en-US',{maximumFractionDigits:0}).format(n)+' ₴';
 const labels=lang==='uk'?['В оренді','Не в оренді','Підтверджені платежі','Обліковані витрати','Різниця','Дані за весь доступний період','Зайнятість автопарку','Фінансовий огляд','Швидкі дії']:['Rented','Not rented','Confirmed payments','Recorded expenses','Difference','All available records','Fleet occupancy','Financial overview','Quick actions'];
 const ring='<svg viewBox="0 0 120 120" width="164" height="164" role="img" aria-label="'+labels[6]+': '+pct+'%"><circle cx="60" cy="60" r="47" fill="none" stroke="var(--line)" stroke-width="14"/><circle cx="60" cy="60" r="47" fill="none" stroke="var(--accent)" stroke-width="14" stroke-linecap="round" stroke-dasharray="'+(295.31*pct/100)+' 295.31" transform="rotate(-90 60 60)"/><text x="60" y="65" text-anchor="middle" font-size="24" font-weight="800" fill="var(--ink)">'+pct+'%</text></svg>';
 const max=Math.max(confirmed,costs,1);
 const bar=(label,n,color)=>'<div class="overview-bar-row"><div class="overview-bar-label"><span>'+label+'</span><b>'+moneyFmt(n)+'</b></div><div class="overview-bar-track"><span style="width:'+Math.max(0,Math.min(100,n/max*100))+'%;background:'+color+'"></span></div></div>';
 return '<section class="overview-visual-grid" aria-label="'+labels[6]+'"><div class="card overview-visual-card"><h2>🚘 '+labels[6]+'</h2><div class="overview-ring">'+ring+'<div class="overview-legend"><div><span class="overview-dot"></span>'+labels[0]+': <b>'+busy+'</b></div><div><span class="overview-dot muted"></span>'+labels[1]+': <b>'+free+'</b></div></div></div></div><div class="card overview-visual-card"><h2>📊 '+labels[7]+'</h2><p class="small">'+labels[5]+'</p>'+bar(labels[2],confirmed,'var(--accent)')+bar(labels[3],costs,'#e69a38')+'<div class="overview-net"><span>'+labels[4]+'</span><strong>'+moneyFmt(confirmed-costs)+'</strong></div></div></section><section class="card overview-actions"><h2>⚡ '+labels[8]+'</h2><div class="overview-action-buttons"><button class="btn secondary" data-action="nav" data-page="cars">🚗 '+t('cars')+'</button><button class="btn secondary" data-action="nav" data-page="requests">📋 '+t('requests')+'</button><button class="btn secondary" data-action="nav" data-page="drivers">👤 '+t('drivers')+'</button><button class="btn secondary" data-action="nav" data-page="announcements">📢 '+t('announcements')+'</button></div></section>';
}
// Owner-only read-only assistant. Answers are calculated from already authorized records.
let aiQuestion='',aiAnswer='';
function aiFinancialRows(days=30){
 const cutoff=Date.now()-days*86400000;
 const recent=(v)=>{const n=Date.parse(v||'');return Number.isFinite(n)&&n>=cutoff;};
 const requests=new Map(records.rental_requests.map(r=>[r.id,r]));
 return records.cars.map(car=>{
  const income=records.payment_claims.filter(p=>p.status==='confirmed'&&requests.get(p.rental_request_id)?.car_id===car.id&&recent(p.confirmed_at||p.created_at)).reduce((n,p)=>n+(Number(p.amount)||0),0);
  const expense=records.expense_entries.filter(x=>x.car_id===car.id&&recent(x.created_at)).reduce((n,x)=>n+(Number(x.amount)||0),0);
  return {car,income,expense,balance:income-expense};
 });
}
function aiExpenseAnomalies(days=30){
 const cutoff=Date.now()-days*86400000;
 const entries=records.expense_entries.filter(x=>Number(x.amount)>0&&Date.parse(x.created_at)>=cutoff);
 const groups=new Map();for(const x of entries){const key=String(x.car_id||'')+':'+String(x.category||'');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(Number(x.amount));}
 const median=values=>{const s=values.slice().sort((a,b)=>a-b);return s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2;};
 return entries.filter(x=>{const values=groups.get(String(x.car_id||'')+':'+String(x.category||''))||[];if(values.length<4)return false;const base=median(values);return Number(x.amount)>=1000&&base>0&&Number(x.amount)>base*3;}).sort((a,b)=>Number(b.amount)-Number(a.amount)).slice(0,5);
}
function nikcarAiRespond(question){
 const q=String(question||'').trim().toLowerCase();
 if(!q)return 'Введіть запитання.';
 const cars=records.cars||[],payments=records.payment_claims||[],expenses=records.expense_entries||[],repairs=records.repair_jobs||[];
 const sum=items=>items.reduce((v,x)=>v+(Number(x.amount)||0),0);
 if(/аномал|незвич|подозр|підозр/.test(q)){const flagged=aiExpenseAnomalies();return flagged.length?'Потенційно незвичні витрати за 30 днів: '+flagged.map(x=>carName(x.car_id)+' — '+money(x.amount)+' ('+x.category+')').join('; ')+'. Перевірте вручну.':'За останні 30 днів значних відхилень за правилом 3× медіани не знайдено. Для оцінки потрібно щонайменше 4 записи на категорію та авто.';}
 if(/по авто|по машин|кажд|кожн|рентабель|прибутков/.test(q)){const rows=aiFinancialRows();return rows.length?rows.map(x=>carName(x.car.id)+': надходження '+money(x.income)+', витрати '+money(x.expense)+', різниця '+money(x.balance)).join('; ')+'. Період 30 днів, лише підтверджені платежі та внесені витрати.':'Автомобілів ще немає.';}
 if(/прибут|дохід|доход|финанс|фінанс|витрат|расход/.test(q))return 'За доступними записами: платежі — '+money(sum(payments.filter(p=>p.status==='confirmed')))+', витрати — '+money(sum(expenses))+'. Це не бухгалтерський прибуток: враховано лише доступні підтверджені платежі та внесені витрати.';
 if(/оренд|аренд|заяв|заявк/.test(q))return 'Очікують рішення: '+records.rental_requests.filter(r=>r.status==='pending').length+' заявок. Активні схвалені заявки: '+records.rental_requests.filter(r=>r.status==='approved').length+'.';
 if(/ремонт|сто|обслуг|техніч/.test(q))return 'У системі '+repairs.length+' записів ремонтів та '+records.fleet_inspections.length+' технічних оглядів. Для рекомендацій за пробігом потрібні актуальні дані.';
 if(/фото|пошкод|повреж|огляд|осмотр/.test(q))return 'Збережено '+records.fleet_damage_reviews.length+' попередніх ІІ-висновків і '+records.fleet_files.filter(x=>['damage_photo','inspection_photo'].includes(x.kind)).length+' фотографій оглядів. Порівняння фото доступне в розділі документів.';
 if(/авто|машин|парк|вільн|свобод/.test(q))return 'Автопарк: '+cars.length+' автомобілів, з них вільні — '+cars.filter(c=>c.status==='free').length+'.';
 return 'Я можу підсумувати автопарк, заявки, підтверджені платежі, витрати, ремонти й фотоогляди. Це локальний аналітичний помічник за даними NikCar; генеративний AI-чат буде підключено окремо.';
}
function nikcarAiPage(){
 if(!isOwner())return '<div class="banner warning">Доступ лише власнику.</div>';
 const pending=records.rental_requests.filter(x=>x.status==='pending').length;
 const unpaid=records.payment_claims.filter(x=>x.status==='declared').length;
 const alerts=[{label:pending?pending+' заявок очікують рішення':'Немає нових заявок',page:'requests',urgent:!!pending},{label:unpaid?unpaid+' платежів потребують перевірки':'Немає неперевірених платежів',page:'payments',urgent:!!unpaid}];
 const financial=aiFinancialRows().sort((a,b)=>b.balance-a.balance);
 const anomalies=aiExpenseAnomalies();
 const reviews=records.fleet_damage_reviews.slice().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,4).map(x=>'<div class="line"><div><b>'+e(carName(x.car_id))+'</b><div class="small">'+e(x.result?.summary||'Попередній висновок')+'</div></div></div>').join('');
 return '<div class="ai-hub"><section class="card"><h2>✦ NikCar AI</h2><p class="small">Помічник власника · читання даних без права змінювати записи. Аналітичні відповіді розраховуються локально, не є висновками мовної моделі.</p><div class="ai-quick"><button class="btn secondary tiny" data-action="ai-ask" data-question="Скільки автомобілів вільно?">Автопарк</button><button class="btn secondary tiny" data-action="ai-ask" data-question="Які фінанси та витрати?">Фінанси</button><button class="btn secondary tiny" data-action="ai-ask" data-question="Які заявки в оренду?">Оренда</button><button class="btn secondary tiny" data-action="ai-ask" data-question="Які фотоогляди?">Фотоогляди</button></div><div class="ai-answer" role="status">'+e(aiAnswer||'Оберіть тему або напишіть запитання про автопарк.')+'</div><form id="nikcar-ai-question" class="chat-compose"><input name="question" maxlength="500" required placeholder="Запитайте про автомобілі, витрати, оренду…" value="'+e(aiQuestion)+'"><button class="btn" type="submit">➤</button></form></section><section class="card"><h3>⚠️ Попередження</h3>'+alerts.map(x=>'<button type="button" class="ai-alert-row" data-action="nav" data-page="'+x.page+'"><span>'+e(x.label)+'</span><span>'+ (x.urgent?'Перевірити':'Переглянути') +' ›</span></button>').join('')+'<p class="small">Зміни платежів, оренди та списання не виконуються автоматично.</p></section><section class="card"><h3>📷 Результати фотооглядів</h3>'+(reviews||'<p class="small">Поки немає висновків.</p>')+'<button class="btn secondary" data-action="nav" data-page="documents">Перейти до фотооглядів</button></section><section class="card"><h3>📊 Автомобілі · 30 днів</h3><p class="small">Підтверджені платежі мінус внесені витрати. Не чистий прибуток: зарплата, податки та інші витрати можуть бути неповними.</p>'+ (financial.length?financial.map(x=>'<div class="ai-finance-row"><b>'+e(carName(x.car.id))+'</b><span>Надходження '+money(x.income)+'</span><span>Витрати '+money(x.expense)+'</span><strong>Різниця '+money(x.balance)+'</strong></div>').join(''):'<p class="small">Автомобілів ще немає.</p>')+'</section><section class="card"><h3>🔎 Незвичні витрати</h3><p class="small">Позначає суми понад 3× медіани при щонайменше 4 записах тієї самої категорії для одного авто за 30 днів. Це сигнал для перевірки, не доказ помилки.</p>'+(anomalies.length?anomalies.map(x=>'<div class="line">'+e(carName(x.car_id))+' · '+e(x.category)+' · '+money(x.amount)+'</div>').join(''):'<p class="small">Підозрілих відхилень за цим правилом немає або даних недостатньо.</p>')+'</section></div>';
}
function dashboardPage(){if(!isOwner())return `<div class="banner warning">${t('notApproved')}</div>`;
 const total=records.cars.length, drivers=records.profiles.filter(x=>x.role==='driver');
 const pending=records.rental_requests.filter(x=>x.status==='pending');
 const urgent=records.sos_requests.filter(x=>['open','claimed'].includes(x.status));
 const nums=[[t('countCars'),total,navIcon('cars')],[t('countDrivers'),drivers.length,navIcon('drivers')],[t('countPending'),pending.length,navIcon('requests')],[t('countSOS'),urgent.length,navIcon('sos')]];
 const cards=nums.map(([label,val,icon])=>`<div class="metric"><span class="metric-icon">${icon}</span><div class="metric-value">${val}</div><div class="small">${label}</div></div>`).join('');
 const requestRows=pending.slice(0,5).map(r=>`<div class="line"><div><b>${e(carName(r.car_id))}</b><div class="small">${e(name(r.driver_id))} · ${d(r.created_at)}</div></div><button class="btn secondary tiny" data-action="nav" data-page="requests">${t('requests')}</button></div>`).join('');
 const sosRows=urgent.slice(0,5).map(x=>`<div class="line"><div><b>${e(t(x.category))}</b><div class="small">${e(name(x.requester_id))} · ${e(x.location_text||'')}</div></div>${status(x.status)}</div>`).join('');
 const hi=lang==='uk'?'Вітаємо в NikCar':'Welcome to NikCar';
 const summary=lang==='uk'?'Управляйте автопарком, перевіряйте заявки та платежі в одному місці.':'Manage your fleet, requests and payments in one workspace.';
 return `<div class="dashboard-hero"><div><span class="hero-overline">NIKCAR · FLEET CONTROL 0.9</span><h2>${hi}</h2><p>${summary}</p></div><img src="./fleet-hero.svg" width="280" height="190" alt="${lang==='uk'?'Векторна ілюстрація NikCar':'NikCar vector illustration'}"></div><div class="metric-grid">${cards}</div>${fleetOverviewVisuals()}${fleetIntelligencePage()}${fleetServicePage()}${fleetEvidencePage()}<div class="notice-line"><span class="notice-dot"></span><b>${t('fuelOff')}</b><span class="small">${t('fuelNotice')}</span></div><div class="two-panel"><div class="card"><div class="panel-heading"><h2>${t('countPending')}</h2><button class="btn secondary tiny" data-action="nav" data-page="requests">${t('reload')}</button></div>${requestRows||`<p>${t('noRequests')}</p>`}</div><div class="card"><h2>${t('sos')}</h2>${sosRows||`<p>${t('noSos')}</p>`}</div></div><div class="two-panel"><div class="card"><h2>${t('newsFeed')}</h2>${records.announcements.slice(0,2).map(a=>`<div class="line"><div><b>${e(a['title_'+lang])}</b><div class="small">${e(a['body_'+lang]).slice(0,165)}</div></div></div>`).join('')||t('emptyNews')}<button class="btn secondary tiny" data-action="nav" data-page="announcements">${t('announcements')}</button></div><div class="card"><h2>${t('releaseSoon')}</h2><p>${t('summaryInfo')}</p><div class="tag warn">${t('onlyPilot')}</div></div></div>`;
}
function driversPage(){if(!isOwner())return `<div class="banner warning">${t('notApproved')}</div>`;
 const people=records.profiles.filter(x=>x.role==='driver').slice().sort((a,b)=>a.full_name.localeCompare(b.full_name,'uk'));
 const list=people.map(p=>{
 const docs=records.driver_documents.filter(doc=>doc.driver_id===p.id);
 const open=records.rental_requests.filter(r=>r.driver_id===p.id&&['pending','approved'].includes(r.status)).length;
 const search=e(((p.full_name||'')+' '+(p.phone||'')).toLowerCase());
 return `<div class="driver-card" data-search="${search}"><div><div class="driver-name">${e(p.full_name||'—')} ${status(p.access)}</div><div class="small">${e(p.phone||t('phone'))}</div><div class="small">${docs.length}/5+ ${t('documents')} · ${open} ${t('requests')}</div></div><div class="driver-actions"><select aria-label="${t('access')}" data-driver-id="${e(p.id)}" class="driver-status-select">${['candidate','active','archived','blocked'].map(v=>`<option value="${v}" ${p.access===v?'selected':''}>${t(v)}</option>`).join('')}</select><button class="btn secondary tiny" data-action="set-driver-access" data-id="${e(p.id)}">${t('applyAccess')}</button><button class="btn secondary tiny" data-action="driver-docs" data-id="${e(p.id)}">${t('documents')}</button></div></div>`;
 }).join('');
 return `<div class="banner">${t('driverStatusHint')}</div><div class="card"><label class="field">${t('driverSearch')}<input id="driver-filter" autocomplete="off" placeholder="${t('driverSearch')}"></label><div id="driver-list">${list||`<p>${t('noDrivers')}</p>`}</div></div>`;
}
function announcementsPage(){const articles=records.announcements.map(a=>`<article class="card news-card"><div class="card-top"><span class="small">${a.pinned?'📌 · ':''}${d(a.created_at)}</span>${isOwner()?`<button class="btn secondary tiny" data-action="delete-announcement" data-id="${e(a.id)}">${t('removeNews')}</button>`:''}</div><h2>${e(a['title_'+lang])}</h2><p class="notice-copy">${e(a['body_'+lang])}</p>${isOwner()?`<button class="btn secondary tiny" data-action="copy-announcement" data-id="${e(a.id)}">${t('copyText')}</button>`:''}</article>`).join('');
 const compose=isOwner()?`<div class="card"><h2>${t('addNews')}</h2><form id="announcement-form" class="form"><div class="row stack"><label class="field" style="flex:1">${t('newsTitleUa')}<input name="title_uk" required maxlength="120"></label><label class="field" style="flex:1">${t('newsTitleEn')}<input name="title_en" required maxlength="120"></label></div><div class="row stack"><label class="field" style="flex:1">${t('newsBodyUa')}<textarea name="body_uk" required maxlength="2200"></textarea></label><label class="field" style="flex:1">${t('newsBodyEn')}<textarea name="body_en" required maxlength="2200"></textarea></label></div><label class="row" style="justify-content:flex-start"><input name="pinned" type="checkbox">${t('pin')}</label><button class="btn" type="submit">${t('addNews')}</button></form></div>`:'';
 return `<div class="notice-line"><span class="notice-dot"></span><b>${t('fuelOff')}</b><span class="small">${t('fuelNotice')}</span></div><div class="news-grid">${compose}<section class="news-list">${articles||`<div class="card">${t('emptyNews')}</div>`}</section></div>`;
}

function carsPage(){const owner=isOwner();const list=records.cars.map(c=>`<div class="card"><div class="car-top"><div class="car-icon">${navIcon('cars')}</div>${status(c.status)}</div><div class="car-art"><img src="./fleet-hero.svg" alt="${lang==='uk'?'Ілюстрація автомобіля':'Car illustration'}" loading="lazy"></div><h2 style="margin-top:8px">${e(c.model)}</h2><div class="small">${e(c.plate)} · ${e(c.year||'')}</div><div class="rate">${money(c.daily_rate)} <span class="small">/ ${lang==='uk'?'доба':'day'}</span></div><div class="car-checks"><span class="small">Офіційні перевірки:</span><a href="https://mtsbu.ua/avtocivilka/perevirka-chinnosti-polisu" target="_blank" rel="noopener noreferrer" class="btn secondary tiny">🛡️ Страховка</a><a href="https://bdr.mvs.gov.ua/" target="_blank" rel="noopener noreferrer" class="btn secondary tiny">⚖️ Штрафи</a><a href="https://e-driver.mvs.gov.ua/" target="_blank" rel="noopener noreferrer" class="btn secondary tiny">🚘 Кабінет водія</a><span class="small">Номер для перевірки: ${e(c.plate)} · дані відкриваються на офіційних сайтах.</span></div>${owner?`<div class="actions" style="flex-wrap:wrap"><button class="btn secondary tiny" data-action="edit-car" data-id="${e(c.id)}">${t('carEdit')}</button><button class="btn secondary tiny" data-action="delete-car" data-id="${e(c.id)}" style="border-color:#b94a4a;color:#ff8f8f">${lang==='uk'?'Видалити':'Delete'}</button></div>`:''}${canApply()&&c.status==='free'?`<button class="btn full" data-action="choose-car" data-id="${e(c.id)}">${t('apply')}</button>`:''}</div>`).join('');const add=owner?`<div class="card" style="margin-top:19px"><h2>${t('newCar')}</h2><div class="card" style="padding:14px;margin:12px 0"><label class="field">📷 Фото техпаспорта або скриншот із Дії (OCR)<input id="tech-passport-photo" type="file" accept="image/jpeg,image/png,image/webp"></label><p class="small" id="tech-passport-status" role="status">Розпізнавання на пристрої. Перевірте дані перед збереженням.</p><p class="small" id="tech-passport-vin" aria-live="polite"></p></div><form class="form" id="new-car"><div class="row stack"><label class="field" style="flex:1">${t('model')}<input name="model" required minlength="2" maxlength="120"></label><label class="field" style="flex:1">${t('plate')}<input name="plate" required maxlength="20"></label></div><div class="row stack"><label class="field" style="flex:1">${t('year')}<input name="year" type="number" min="1990" max="2100"></label><label class="field" style="flex:1">${t('rate')}<input name="rate" type="number" step="0.01" min="1" required></label></div><div class="actions"><button class="btn" type="submit">${t('saveCar')}</button><button class="btn secondary" type="button" data-action="clear-new-car">${lang==='uk'?'Очистити поля':'Clear fields'}</button></div></form></div>`:'';const edit=owner&&carEditor?(()=>{const c=records.cars.find(v=>v.id===carEditor);return c?`<div class="card" style="margin-top:16px"><h2>${t('carEdit')} · ${e(c.plate)}</h2><form id="edit-car-form" class="form"><input type="hidden" name="id" value="${e(c.id)}"><div class="row stack"><label class="field" style="flex:1">${t('model')}<input name="model" value="${e(c.model)}" required maxlength="120"></label><label class="field" style="flex:1">${t('plate')}<input name="plate" value="${e(c.plate)}" required maxlength="20"></label></div><div class="row stack"><label class="field" style="flex:1">${t('year')}<input name="year" type="number" min="1990" max="2100" value="${e(c.year||'')}"></label><label class="field" style="flex:1">${t('rate')}<input name="rate" type="number" step="0.01" min="1" value="${Number(c.daily_rate)}" required></label></div><div class="actions"><button type="submit" class="btn">${t('saveChanges')}</button><button type="button" class="btn secondary" data-action="cancel-car-edit">${t('cancelEdit')}</button></div></form></div>`:'';})():'';return `<p>${owner?t('summaryInfo'):t('registerInfo')}</p><div class="cards">${list||`<div class="empty-state"><img src="./fleet-hero.svg" loading="lazy" alt=""><div><h3>${t('noCars')}</h3><p>${lang==='uk'?'Додайте перший автомобіль, щоб почати роботу з автопарком.':'Add your first vehicle to start managing the fleet.'}</p></div></div>`}</div>${edit}${add}`}
function docFor(kind,driver,car=null){return records.driver_documents.find(d=>d.kind===kind&&d.driver_id===driver&&(kind==='rental_contract'?d.car_id===car:d.car_id===null));}
function docRequiredTypes(){return ['passport_1','passport_2','passport_3','tax_id','rental_contract'];}
function hasLocalDocs(car){return docRequiredTypes().every(kind=>!!docFor(kind,me.id,kind==='rental_contract'?car:null));}
function uploadItem(kind,driver,car=null){const doc=docFor(kind,driver,car);const val=kind==='rental_contract'&&!car?`<div class="small">${t('selectFirst')}</div>`:'';
 const own=me?.id===driver;
 return `<div class="line"><div style="min-width:0"><b>${e(t(kind))}</b><div class="small">${doc?`${t('docsDone')} · ${d(doc.created_at)}`:t('docsWaiting')}</div>${val}</div><div class="actions">${doc?`<button type="button" class="btn secondary tiny" data-action="open-doc" data-id="${e(doc.id)}">${t('openDocument')}</button>`:''}${own&&(!['rental_contract'].includes(kind)||car)?`<label class="btn secondary tiny" style="cursor:pointer">${t('upload')}<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden data-doc-kind="${kind}" data-car="${car||''}" /></label>`:''}</div></div>`;}
function documentsPage(){if(isOwner()){
 const selectedDriver=selectedDriverId&&records.profiles.some(p=>p.id===selectedDriverId&&p.role==='driver')?selectedDriverId:null;
 const profiles=records.profiles.filter(p=>p.role==='driver'&&(!selectedDriver||p.id===selectedDriver));
 const lines=profiles.map(p=>{const docs=records.driver_documents.filter(d=>d.driver_id===p.id);return `<div class="card"><h2>${e(p.full_name||'—')}</h2><div class="small">${e(p.phone||'')} · ${e(p.access||'')}</div>${docs.length?docs.map(d=>`<div class="line"><div>${e(t(d.kind))}${d.car_id?` <span class="small">· ${e(carName(d.car_id))}</span>`:''}</div><button class="btn secondary tiny" data-action="open-doc" data-id="${e(d.id)}">${t('openDocument')}</button></div>`).join(''):`<p>${t('docsWaiting')}</p>`}</div>`;}).join('');return `<div class="banner warning">${t('docOwnerNote')}${selectedDriver?` · ${e(name(selectedDriver))}`:''}</div>${selectedDriver?`<button class="btn secondary tiny" data-action="all-driver-docs" style="margin-bottom:12px">${lang==='uk'?'Показати всіх водіїв':'Show all drivers'}</button>`:''}<div class="cards">${lines||`<div class="card">${t('empty')}</div>`}</div>`;
 }
 if(!me||me.role!=='driver')return '';
 const car=records.cars.find(c=>c.id===selectedCar);
 const available=records.cars.filter(c=>c.status==='free');
 const carOptions=available.map(c=>`<option value="${e(c.id)}" ${selectedCar===c.id?'selected':''}>${e(c.model)} · ${e(c.plate)}</option>`).join('');
 const ready=!!car&&hasLocalDocs(car.id);
 return `<div class="banner warning">${t('docsInfo')}</div><div class="banner">🔐 ${t('docsPrivacy')}</div><div class="card"><h2>${t('selectedCar')}</h2><label class="field">${t('chooseCar')}<select id="document-car"><option value="">${t('selectFirst')}</option>${carOptions}</select></label><div class="small" style="margin-top:9px">${car?`${e(car.model)} · ${e(car.plate)} · ${money(car.daily_rate)}`:''}</div></div><div class="card"><h2>${t('docsTitle')}</h2>${docRequiredTypes().map(kind=>uploadItem(kind,me.id,kind==='rental_contract'?selectedCar:null)).join('')}<p class="note" style="margin-top:15px">${t('docLimit')}</p></div><div class="card"><button class="btn full" data-action="submit-doc-choice" ${ready?'':'disabled'}>${t('submitCar')}</button><p>${ready?t('docsDone'):t('docsMissing')}</p></div>`;
}
function requestsPage(){
 const rows=records.rental_requests.map(r=>{
  const isActive=r.status==='approved'&&!!r.handed_over_at&&!r.returned_at;
  const rentalDetails=r.handed_over_at?`<div class="small">${lang==='uk'?'Видано':'Handed over'}: ${d(r.handed_over_at)} · ${lang==='uk'?'Пробіг':'Odometer'} ${e(r.odometer_out_km)} км · ${lang==='uk'?'Повний бак':'Full tank'} ✓</div>`:'';
  const returnDetails=r.returned_at?`<div class="small">${lang==='uk'?'Повернуто':'Returned'}: ${d(r.returned_at)} · ${e(r.odometer_in_km)} км · ${lang==='uk'?'Повний бак':'Full tank'} ✓</div>`:'';
  const ownerButtons=isOwner()&&r.status==='approved'?(isActive?`<button class="btn tiny" data-action="return-rental" data-id="${e(r.id)}">${lang==='uk'?'Прийняти повернення':'Accept return'}</button>`:`<button class="btn tiny" data-action="handover-rental" data-id="${e(r.id)}">${lang==='uk'?'Видати авто':'Hand over car'}</button>`):'';
  return `<div class="line"><div><b>${e(carName(r.car_id))}</b><div class="small">${e(name(r.driver_id))} · ${d(r.created_at)}</div><div style="margin-top:5px">${status(r.status)} ${isActive?'<span class="tag">🚗 '+(lang==='uk'?'В оренді':'On rent')+'</span>':''}</div>${rentalDetails}${returnDetails}</div><div class="actions">${isOwner()&&r.status==='pending'?`<button class="btn tiny" data-action="approve-request" data-id="${r.id}">${t('approve')}</button><button class="btn secondary tiny" data-action="reject-request" data-id="${r.id}">${t('reject')}</button>`:''}${r.driver_id===me.id&&r.status==='pending'?`<button class="btn secondary tiny" data-action="cancel-request" data-id="${r.id}">${t('cancel')}</button>`:''}${ownerButtons}</div></div>`;
 }).join('');
 return `<div class="banner warning">${t('requestInfo')}</div><div class="card">${rows||t('noRequests')}</div>`;
}
// Presence is ephemeral: online means a connected, authenticated browser session.
let chatPresenceChannel=null,chatPresenceUser=null,chatOnlineUsers=new Set();
function refreshChatPresence(){
 const ids=new Set();
 const state=chatPresenceChannel?.presenceState?.()||{};
 for(const entries of Object.values(state))for(const entry of entries){if(entry?.user_id)ids.add(String(entry.user_id));}
 chatOnlineUsers=ids;
 const count=document.getElementById('chat-online-count');if(count)count.textContent=ids.size+' онлайн';
 document.querySelectorAll('[data-presence-user]').forEach(el=>{const online=ids.has(el.dataset.presenceUser);el.classList.toggle('is-online',online);el.setAttribute('aria-label',online?'Онлайн':'Не в мережі');});
}
function startChatPresence(){
 if(!sb||!user||!activeMember()||chatPresenceUser===user.id)return;
 if(chatPresenceChannel){void sb.removeChannel(chatPresenceChannel);chatPresenceChannel=null;}
 chatPresenceUser=user.id;
 chatPresenceChannel=sb.channel('nikcar-chat-presence',{config:{presence:{key:user.id}}})
  .on('presence',{event:'sync'},refreshChatPresence)
  .on('presence',{event:'join'},refreshChatPresence)
  .on('presence',{event:'leave'},refreshChatPresence)
  .subscribe(async status=>{if(status==='SUBSCRIBED'&&user?.id===chatPresenceUser){await chatPresenceChannel?.track({user_id:user.id,at:new Date().toISOString()});refreshChatPresence();}});
}
function chatPage(){
 if(!activeMember())return `<div class="banner warning">${t('notApproved')}</div>`;
 const members=records.profiles.filter(p=>p.access==='active'&&(p.role==='owner'||p.role==='driver'));
 const people=members.map(p=>`<span class="chat-person"><span class="presence-dot ${chatOnlineUsers.has(String(p.user_id))?'is-online':''}" data-presence-user="${e(p.user_id)}" aria-label="${chatOnlineUsers.has(String(p.user_id))?'Онлайн':'Не в мережі'}"></span><span>${e(p.full_name||'Учасник')}${p.id===me.id?' (ви)':''}</span></span>`).join('');
 const lines=records.chat_messages.map(m=>`<div class="bubble ${m.sender_id===me.id?'mine':''}"><div class="chat-message-author">${e(name(m.sender_id))}</div><p>${e(m.body)}</p><small>${d(m.created_at)}</small></div>`).join('');
 return `<section class="card chat-panel"><div class="chat-header"><div class="chat-avatar">💬</div><div><b>Чат NikCar</b><div class="small"><span id="chat-online-count">${chatOnlineUsers.size} онлайн</span> · спільний чат автопарку</div></div></div><div class="chat-people" aria-label="Учасники чату">${people||'<span class="small">Учасників поки немає</span>'}</div><div class="chatbox" id="messages" role="log" aria-label="Повідомлення">${lines||`<span class="small">${t('noChat')}</span>`}</div><form id="chat-send" class="chat-compose"><input name="text" aria-label="${t('message')}" placeholder="Написати повідомлення…" autocomplete="off" maxlength="2000" required><button class="btn" type="submit" aria-label="${t('send')}">➤</button></form></section>`;
}
function sosPage(){if(!activeMember())return `<div class="banner warning">${t('notApproved')}</div>`;const form=!isOwner()?`<div class="card" style="margin-bottom:15px"><form id="sos-create" class="form"><label class="field">${t('sosType')}<select name="category">${['jump_start','tow','wheel','other'].map(v=>`<option value="${v}">${t(v)}</option>`).join('')}</select></label><label class="field">${t('location')}<input name="location" maxlength="200"></label><label class="field">${t('description')}<textarea name="note" maxlength="1000"></textarea></label><button class="btn" type="submit">${t('createSos')}</button></form></div>`:'';const list=records.sos_requests.map(s=>{const claim=s.status==='open'&&s.requester_id!==me.id&&!isOwner();const release=s.status==='claimed'&&s.helper_id===me.id;const cancel=s.status==='open'&&s.requester_id===me.id;return `<div class="line"><div><b>${e(t(s.category))}</b><div class="small">${e(name(s.requester_id))} · ${d(s.created_at)}</div><p>${e(s.location_text||'')} ${e(s.note||'')}</p>${status(s.status)} ${s.helper_id?`<span class="small">${t('helper')}: ${e(name(s.helper_id))}</span>`:''}</div><div class="actions">${claim?`<button class="btn tiny" data-action="claim-sos" data-id="${s.id}">${t('claim')}</button>`:''}${release?`<button class="btn secondary tiny" data-action="release-sos" data-id="${s.id}">${t('release')}</button><button class="btn tiny" data-action="finish-sos" data-id="${s.id}">${t('complete')}</button>`:''}${cancel?`<button class="btn secondary tiny" data-action="cancel-sos" data-id="${s.id}">${t('cancelSos')}</button>`:''}</div></div>`}).join('');return `<p>${t('sosInfo')}</p>${form}<div class="card">${list||t('noSos')}</div>`}
function paymentsPage(){
 const list=records.payment_claims.slice().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
 const rows=list.map(p=>`<div class="line"><div><b>${e(name(p.driver_id))}</b> · ${money(p.amount)}<div class="small">${e(carName(records.rental_requests.find(r=>r.id===p.rental_request_id)?.car_id))} · ${e(t(p.method))} · ${d(p.created_at)}</div>${p.driver_note?`<div class="small">${e(p.driver_note)}</div>`:''}${p.owner_note?`<div class="small">${e(p.owner_note)}</div>`:''}<div>${status(p.status)}</div></div>${isOwner()&&p.status==='declared'?`<div class="actions"><button class="btn tiny" data-action="confirm-payment" data-id="${e(p.id)}">${t('confirmPayment')}</button><button class="btn secondary tiny" data-action="reject-payment" data-id="${e(p.id)}">${t('rejectPayment')}</button></div>`:''}</div>`).join('');
 const eligible=records.rental_requests.filter(r=>r.driver_id===me.id&&r.status==='approved');
 const form=canApply()?`<div class="card"><h2>${t('paidClaim')}</h2><div class="banner warning">${t('paymentHint')}</div>${eligible.length?`<form class="form" id="cash-payment-form"><label class="field">${t('paymentChooseRental')}<select name="rental" required>${eligible.map(r=>`<option value="${e(r.id)}">${e(carName(r.car_id))} · ${d(r.created_at)}</option>`).join('')}</select></label><div class="row stack"><label class="field" style="flex:1">${t('paymentMethod')}<select name="method"><option value="cash">${t('cash')}</option><option value="card_transfer">${t('card_transfer')}</option></select></label><label class="field" style="flex:1">${t('amount')}<input name="amount" type="number" step="0.01" min="0.01" max="1000000" required></label></div><label class="field">${t('paymentNote')}<textarea name="note" maxlength="500" placeholder=""></textarea></label><button class="btn" type="submit">${t('paidClaim')}</button></form>`:`<p>${t('noApprovedRental')}</p>`}</div>`:'';
 return `<div class="banner warning">${isOwner()?t('paymentsOwnerHint'):t('paymentHint')}</div>${form}<div class="card"><h2>${t('paymentTitle')}</h2>${rows||`<p>${t('paymentNoData')}</p>`}</div>`;
}
function repairTotal(j){return Number(j.labor_cost||0)+records.repair_parts.filter(p=>p.repair_id===j.id).reduce((n,p)=>n+Number(p.quantity||0)*Number(p.unit_price||0),0)}
function smartRepairHints(symptoms){
 const lower=(symptoms||'').toLowerCase();const groups=[
  {keys:['тормоз','гальм','колод','brake'],items:['Колодки','Гальмівні диски','Датчики зносу']},
  {keys:['ходов','підвіск','стук','suspension'],items:['Сайлентблоки','Стійки стабілізатора','Амортизатори']},
  {keys:['масло','олив','filter','фільтр'],items:['Оливний фільтр','Моторна олива','Прокладка']},
  {keys:['заряд','акум','battery','стартер'],items:['АКБ','Реле / контактори','Клеми']},
  {keys:['кондиц','кондицi','клімат','ac compressor'],items:['Фільтр салону','Компресор кондиціонера','Ущільнення']}
 ];return [...new Set(groups.filter(g=>g.keys.some(k=>lower.includes(k))).flatMap(g=>g.items))].slice(0,10);
}
function repairsPage(){if(!isOwner())return `<div class="banner warning">${t('notApproved')}</div>`;
 const all=records.repair_jobs.slice().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
 const current=all.find(j=>j.id===currentRepair)||all[0];if(current)currentRepair=current.id;
 const ownparts=current?records.repair_parts.filter(p=>p.repair_id===current.id):[];
 const carOptions=records.cars.map(c=>`<option value="${e(c.id)}">${e(c.model)} · ${e(c.plate)}</option>`).join('');
 const newform=`<div class="card"><h2>${t('repairCreate')}</h2>${records.cars.length?`<form id="repair-create" class="form"><label class="field">${t('repairCar')}<select name="car" required>${carOptions}</select></label><label class="field">${t('repairName')}<input name="title" required maxlength="180"></label><label class="field">${t('repairVIN')}<input name="vin" maxlength="17" minlength="17" pattern="[A-HJ-NPR-Za-hj-npr-z0-9]{17}" placeholder="XXXXXXXXXXXXXXXXX"></label><label class="field">${t('repairSymptoms')}<div class="row"><textarea id="repair-voice-target" name="symptoms" maxlength="2000" style="width:100%"></textarea><button class="btn secondary tiny" data-action="voice-repair" type="button" title="${t('repairVoice')}">🎙</button></div></label><label class="field">${t('repairLabor')}<input name="labor" type="number" min="0" step="0.01" value="0" required></label><button class="btn" type="submit">${t('repairCreate')}</button></form>`:`<p>${t('noCars')}</p>`}</div>`;
 const detail=current?`<div class="card"><h2>${t('repairParts')} · ${e(current.title)} ${status(current.status==='draft'?'repairDraft':'repairPosted')}</h2><div class="small">${e(carName(current.car_id))} · VIN ${e(current.vin||'—')}</div><div class="banner">${t('repairAiInfo')}</div><p class="small">${t('repairSuggestions')}: ${e(smartRepairHints(current.symptoms).join(', ')||'—')}</p><p><a target="_blank" rel="noopener noreferrer" href="https://intercars.com.ua/ic-katalog-online-ua/">${t('repairSearch')} ↗</a></p><p class="note">${t('repairSource')}</p>${ownparts.map(p=>`<div class="line"><div><b>${e(p.item_name)}</b><div class="small">${e(p.article||'')} · ${e(p.supplier||'')} · ${Number(p.quantity)} × ${money(p.unit_price)}</div>${p.supplier_url?`<a href="${e(p.supplier_url)}" target="_blank" rel="noopener noreferrer">${t('repairLink')} ↗</a>`:''}</div><div class="actions"><b>${money(Number(p.quantity)*Number(p.unit_price))}</b>${current.status==='draft'?`<button class="btn secondary tiny" data-action="remove-part" data-id="${e(p.id)}">${t('repairDelete')}</button>`:''}</div></div>`).join('')}${current.status==='draft'?`<form id="repair-add-part" class="form"><label class="field">${t('repairPartName')}<input name="item" required maxlength="200"></label><div class="row stack"><label class="field" style="flex:1">${t('repairArticle')}<input name="article" maxlength="120"></label><label class="field" style="flex:1">${t('repairSupplier')}<input name="supplier" maxlength="120" value="Inter Cars"></label></div><div class="row stack"><label class="field" style="flex:1">${t('repairQty')}<input name="qty" type="number" min="0.01" max="10000" step="0.01" required value="1"></label><label class="field" style="flex:1">${t('repairPrice')}<input name="unit_price" type="number" min="0" max="1000000" step="0.01" required></label></div><label class="field">${t('repairUrl')}<input name="url" type="url" maxlength="1200" pattern="https://.*" placeholder="https://..."></label><button class="btn" type="submit">${t('repairAdd')}</button></form>`:''}<div class="line"><b>${t('repairTotal')}</b><strong>${money(repairTotal(current))}</strong></div>${current.status==='draft'?`<div class="banner warning">${t('repairPostedWarn')}</div><button class="btn" data-action="post-repair" data-id="${e(current.id)}">${t('repairPost')}</button>`:''}</div>`:'';
 return `<div class="banner warning">${t('pendingFeature')}</div><div class="two-panel"><div>${newform}</div><div class="card"><h2>${t('repairs')}</h2>${all.map(j=>`<div class="line"><div><b>${e(j.title)}</b><div class="small">${e(carName(j.car_id))} · ${money(repairTotal(j))}</div></div><button class="btn secondary tiny" data-action="select-repair" data-id="${e(j.id)}">${status(j.status==='draft'?'repairDraft':'repairPosted')}</button></div>`).join('')||`<p>${t('repairNoData')}</p>`}</div></div>${detail}`;
}
function accountPage(){return `<div class="cards account-grid"><div class="card"><h2>${t('accountState')}</h2><div class="line"><span>${t('role')}</span>${status(me.role)}</div><div class="line"><span>${t('access')}</span>${status(me.access)}</div><form class="form" id="profile-update" style="margin-top:14px"><label class="field">${t('fullname')}<input name="fullname" maxlength="150" value="${e(me.full_name)}"></label><label class="field">${t('phone')}<input name="phone" maxlength="40" value="${e(me.phone||'')}"></label><button class="btn" type="submit">${t('saveProfile')}</button></form></div><div class="card"><h2>${t('account')}</h2><p>${e(user.email||'')}</p><p>${t('deleteNotice')}</p><p class="banner warning">${t(isOwner()?'paymentsStatus':'paymentHint')}</p><button class="btn secondary" data-action="change-password">${lang==='uk'?'Змінити пароль':'Change password'}</button> <button class="btn secondary" data-action="signout">${t('signout')}</button></div></div>`}
let passportOcrBusy=false;
function parseTechPassport(text){
 const raw=String(text||'').replace(/\u00a0/g,' ').replace(/[‐‑–—]/g,'-');
 const lines=raw.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
 const extract=(pattern)=>{
  const i=lines.findIndex(x=>pattern.test(x));
  if(i<0)return '';
  const line=lines[i],match=line.match(pattern);
  const tail=line.slice(match.index+match[0].length).replace(/^[\s:–-]+/,'').trim();
  return tail||lines[i+1]||'';
 };
 const code=c=>extract(new RegExp('^'+c.replace('.','\\.')+'\\s*[:.\\-]?\\s*','i'));
 const make=extract(/^(?:марка|make|brand)\s*:/i)||code('D.1');
 const model=extract(/^(?:модель|model)\s*:/i)||code('D.3');
 const vinSource=extract(/^(?:VIN|номер кузова|ідентифікаційний номер)\s*:/i)||code('E');
 const vin=(vinSource.match(/\b[A-HJ-NPR-Z0-9]{17}\b/i)||raw.match(/\b[A-HJ-NPR-Z0-9]{17}\b/i)||[])[0]||'';
 const plateSource=extract(/^(?:державний номер|номерний знак|реєстраційний номер|номер авто|plate)\s*:/i)||code('A');
 // Ukrainian plate: two letters, four digits, two letters; tolerate OCR spacing and Cyrillic lookalikes.
 const platePattern=/[A-ZА-ЯІЇЄ]{2}[\s-]*[0-9OО]{4}[\s-]*[A-ZА-ЯІЇЄ]{2}/ig;
 const candidates=[...plateSource.matchAll(platePattern),...raw.matchAll(platePattern)];
 const plate=candidates.length?candidates[0][0].replace(/[\s-]/g,''):'';
 // Dates in Diia screenshots (updated/insurance) are NOT manufacturing years.
 const yearSource=extract(/^(?:рік випуску|рік виробництва|year of manufacture|рік виготовлення)\s*:/i);
 const yearMatch=yearSource.match(/\b(?:19|20)\d{2}\b/);
 const year=yearMatch?yearMatch[0]:'';
 const cleanedModel=[make,model].map(x=>x.replace(/\s{2,}.*/,'').trim()).filter(Boolean).join(' ').slice(0,120);
 return {plate,model:cleanedModel,year,vin};
}
async function readTechPassport(file){
 const status=document.getElementById('tech-passport-status'),input=document.getElementById('tech-passport-photo');
 if(!status||!input||passportOcrBusy||!isOwner())return;
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||!file.size||file.size>6291456){status.textContent='Лише JPG, PNG, WEBP до 6 МБ';return;}
 passportOcrBusy=true;input.disabled=true;status.textContent='Розпізнавання фото або скриншота Дії…';
 try{
  if(!window.Tesseract)await new Promise((ok,fail)=>{
   const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';script.onload=ok;script.onerror=fail;document.head.appendChild(script);
  });
  const worker=await window.Tesseract.createWorker('eng+ukr',1);
  let result;try{result=await worker.recognize(file);const initial=parseTechPassport(result.data.text);if(!initial.plate){try{const img=await createImageBitmap(file);const canvas=document.createElement('canvas');canvas.width=Math.min(img.width,1600);canvas.height=Math.round(img.height*0.4*canvas.width/img.width);const ctx=canvas.getContext('2d');ctx.drawImage(img,0,img.height*0.6,img.width,img.height*0.4,0,0,canvas.width,canvas.height);img.close();const lower=await worker.recognize(canvas);result.data.text+='\n'+lower.data.text;}catch(_){/* Keep original OCR result */}}}finally{await worker.terminate();}
  const values=parseTechPassport(result.data.text),form=document.getElementById('new-car');
  if(!form)return;
  let filled=0;
  for(const name of ['plate','model','year']){
   const field=form.elements.namedItem(name);
   if(field&&values[name]&&(!field.value.trim()||name==='plate'&&field.dataset.ocrFilled==='1')){field.value=values[name];field.dataset.ocrFilled='1';filled++;}
  }
  form.dataset.dirty='1';captureNewCarDraft();
  const vinPreview=document.getElementById('tech-passport-vin');
  if(vinPreview)vinPreview.textContent=values.vin?'VIN: '+values.vin+' (лише попередній перегляд)':'VIN не розпізнано';
  status.textContent=filled?'Заповнено полів: '+filled+'. '+(!values.plate?'Держномер не знайдено — введіть вручну. ':'')+(!values.year?'Рік випуску не вказаний — не беремо дату оновлення Дії. ':'')+'Перевірте дані. Тариф введіть вручну.':'Не вдалося впевнено визначити марку, модель або номер. Заповніть поля вручну.';
 }catch(err){status.textContent='Не вдалося розпізнати. Перевірте інтернет для завантаження OCR або введіть дані вручну.';}
 finally{passportOcrBusy=false;input.disabled=false;input.value='';}
}
// Keep the owner's new-car draft while navigating between tabs or refreshing data.
// In-memory only: no personal data, credentials or unfinished forms in browser storage.
let newCarDraft=null;
function saveNewCarDraft(){
 if(!user||!isOwner()||!newCarDraft||newCarDraft.userId!==user.id)return;
 try{sessionStorage.setItem('nikcar-car-draft:'+user.id,JSON.stringify(newCarDraft.values));}catch(_){}
}
function readNewCarDraft(){
 if(!user||!isOwner()||newCarDraft?.userId===user.id)return;
 try{
  const values=JSON.parse(sessionStorage.getItem('nikcar-car-draft:'+user.id)||'null');
  if(values&&typeof values==='object'&&!Array.isArray(values)){
   newCarDraft={userId:user.id,values:Object.fromEntries(['model','plate','year','rate'].map(k=>[k,typeof values[k]==='string'?values[k]:'']))};
  }
 }catch(_){}
}
function captureNewCarDraft(){
 const form=document.getElementById('new-car');
 if(!form?.elements?.namedItem||!user||!isOwner())return;
 newCarDraft={userId:user.id,values:Object.fromEntries(['model','plate','year','rate'].map(name=>[name,form.elements.namedItem(name)?.value||'']))};
 saveNewCarDraft();
}
function clearNewCarForm(){
 const form=document.getElementById('new-car');
 if(form){form.reset();form.dataset.dirty='0';for(const field of form.querySelectorAll('input')){if(field.type!=='file'){field.value='';delete field.dataset.ocrFilled;}}}
 newCarDraft=null;
 if(user?.id){try{sessionStorage.removeItem('nikcar-car-draft:'+user.id);}catch(_){}ownerUiDrafts.delete(user.id+':new-car');}
 const vin=document.getElementById('tech-passport-vin');if(vin)vin.textContent='';
 const status=document.getElementById('tech-passport-status');if(status)status.textContent='Розпізнавання на пристрої. Перевірте дані перед збереженням.';
}
function restoreNewCarDraft(){
 readNewCarDraft();
 const form=document.getElementById('new-car');
 if(!form?.elements?.namedItem||!newCarDraft||newCarDraft.userId!==user?.id)return;
 for(const [name,value] of Object.entries(newCarDraft.values)){
  const input=form.elements.namedItem(name);
  if(input)input.value=value;
 }
}
// Preserve unfinished owner inputs and driver-access selections between tabs.
// Never persist passwords, files, private documents or form data to localStorage.
const ownerUiDrafts=new Map();
function captureOwnerUiDraft(){
 if(!user||!isOwner())return;
 const forms=[...document.querySelectorAll('#root form')];
 for(const form of forms){
  if(!form.id||['auth-form','profile-update','chat-send'].includes(form.id))continue;
  const fields=[...form.querySelectorAll('input,select,textarea')].filter(el=>
   el.name&&el.type!=='password'&&el.type!=='file'&&el.type!=='hidden');
  if(!fields.length)continue;
  const values={};
  for(const el of fields)values[el.name]=el.type==='checkbox'?el.checked:el.value;
  ownerUiDrafts.set(user.id+':'+form.id,values);
 }
 const selections={};
 document.querySelectorAll('select[data-driver-id]').forEach(el=>{selections[el.dataset.driverId]=el.value;});
 if(Object.keys(selections).length)ownerUiDrafts.set(user.id+':driver-access',selections);
}
function restoreOwnerUiDraft(){
 if(!user||!isOwner())return;
 for(const form of document.querySelectorAll('#root form')){
  if(!form.id||form.id==='new-car')continue;
  const values=ownerUiDrafts.get(user.id+':'+form.id);
  if(!values)continue;
  for(const el of form.querySelectorAll('input,select,textarea')){
   if(!el.name||!(el.name in values)||el.type==='password'||el.type==='file'||el.type==='hidden')continue;
   if(el.type==='checkbox')el.checked=!!values[el.name];else el.value=values[el.name];
  }
 }
 const selections=ownerUiDrafts.get(user.id+':driver-access')||{};
 document.querySelectorAll('select[data-driver-id]').forEach(el=>{
  const value=selections[el.dataset.driverId];
  if(value&&[...el.options].some(opt=>opt.value===value))el.value=value;
 });
}
function render(){captureOwnerUiDraft();captureNewCarDraft();document.documentElement.lang=lang;if(!configured){root.innerHTML=configuredPage();return;}if(!sb){root.innerHTML='<div class="loading">NikCar · Cloud Pilot</div>';return;}if(!user||recoveryMode){root.innerHTML=authPage();return;}if(!me){root.innerHTML=`<div class="auth-layout"><div class="auth-box"><h1>${t('notFound')}</h1><button class="btn" data-action="refresh">${t('reload')}</button><button class="btn secondary" data-action="signout">${t('signout')}</button></div></div>`;return;}const titles={dashboard:t('dashboardTitle'),drivers:t('driversTitle'),announcements:t('announcements'),cars:t('cars'),requests:t('requestTitle'),documents:isOwner()?t('docOwnerView'):t('docsTitle'),chat:t('chatTitle'),'nikcar-ai':'NikCar AI',sos:t('sosTitle'),account:t('account'),payments:t('paymentTitle'),repairs:t('repairTitle')};const b={payments:paymentsPage,repairs:repairsPage,dashboard:dashboardPage,drivers:driversPage,announcements:announcementsPage,cars:carsPage,requests:requestsPage,documents:documentsPage,chat:chatPage,'nikcar-ai':nikcarAiPage,sos:sosPage,account:accountPage};root.innerHTML=layout(b[page](),titles[page]);restoreNewCarDraft();restoreOwnerUiDraft();if(page==='chat'){const el=document.getElementById('messages');if(el)el.scrollTop=el.scrollHeight;}}
async function load({preserveDraft=false}={}){
 if(!sb||!user){me=null;records=emptyRecords();render();return;}
 const expectedUserId=user.id,version=++loadVersion;
 let accessChanged=false;
 try{
  const {data,error}=await sb.from('profiles').select('id,user_id,full_name,phone,role,access,created_at').eq('user_id',expectedUserId).maybeSingle();
  if(version!==loadVersion||user?.id!==expectedUserId)return;
  if(error)throw error;
  accessChanged=(me?.role||'')!==(data?.role||'')||(me?.access||'')!==(data?.access||'');
  me=data;
  if(me&&isOwner()&&!sessionInitialized)page='dashboard';
  if(me&&activeMember())startChatPresence();
  sessionInitialized=true;
  if(me){
   const targets=[sb.from('payment_claims').select('*').order('created_at',{ascending:false}).limit(250),sb.from('repair_jobs').select('*').order('created_at',{ascending:false}).limit(150),sb.from('repair_parts').select('*').limit(500),sb.from('expense_entries').select('*').limit(200),sb.from('fleet_service_events').select('*').order('created_at',{ascending:false}).limit(500),sb.from('fleet_files').select('*').order('created_at',{ascending:false}).limit(250),sb.from('fleet_inspections').select('*').order('inspected_at',{ascending:false}).limit(250),sb.from('fleet_damage_reviews').select('*').order('created_at',{ascending:false}).limit(100),sb.from('cars').select('*').order('model'),sb.from('rental_requests').select('*').order('created_at',{ascending:false}).limit(150),sb.from('chat_messages').select('*').order('created_at',{ascending:true}).limit(100),sb.from('sos_requests').select('*').order('created_at',{ascending:false}).limit(100),sb.from('profiles').select('id,user_id,full_name,phone,role,access'),sb.from('driver_documents').select('id,driver_id,car_id,kind,object_path,created_at'),sb.from('announcements').select('*').order('pinned',{ascending:false}).order('created_at',{ascending:false}).limit(80)];
   const loaded=await Promise.all(targets);
   if(version!==loadVersion||user?.id!==expectedUserId)return;
   const keys=['payment_claims','repair_jobs','repair_parts','expense_entries','fleet_service_events','fleet_files','fleet_inspections','fleet_damage_reviews','cars','rental_requests','chat_messages','sos_requests','profiles','driver_documents','announcements'];
   const nextRecords=emptyRecords();
   for(let i=0;i<loaded.length;i++){if(loaded[i].error)throw loaded[i].error;nextRecords[keys[i]]=loaded[i].data||[];}
   records=nextRecords;
  }else records=emptyRecords();
  if(!preserveDraft||forceMutationRefresh||accessChanged||!hasUnsavedForm()){render();forceMutationRefresh=0;}
 }catch(err){
  if(version!==loadVersion||user?.id!==expectedUserId)return;
  toast(`${t('systemError')}: ${err.message||err}`);
  if(!preserveDraft||forceMutationRefresh||accessChanged||!hasUnsavedForm()){render();forceMutationRefresh=0;}
 }
}
async function mutation(promise,success){
 const {error,data}=await promise;
 if(error){toast(error.message);return false;}
 if(Array.isArray(data)&&data.length===0){toast(lang==='uk'?'Заявка вже змінена іншим водієм. Оновлюємо статус.':'This request was already changed by someone else. Refreshing.');await load();return false;}
 toast(success||'OK');
 // Leave this flag set if a newer background load supersedes our refresh.
 // The first successfully rendered load consumes it (even with a dirty form).
 forceMutationRefresh++;
 await load();
 return true;
}
async function clickAction(btn){const a=btn.dataset.action,id=btn.dataset.id;if(a==='damage-decision'){
  if(!isOwner())return;
  const decision=btn.dataset.decision;
  if(!['accepted','rejected','needs_inspection'].includes(decision))return;
  return mutation(sb.from('fleet_damage_reviews').update({owner_decision:decision,confirmed_at:new Date().toISOString()}).eq('id',id).is('owner_decision',null).select());
 }
 if(a==='fleet-open-file'){
  if(!isOwner())return;
  const file=records.fleet_files.find(x=>x.id===id);if(!file)return;
  const tab=window.open('about:blank','_blank');
  try{
   const {data,error}=await sb.storage.from('nikcar-fleet-private').createSignedUrl(file.object_path,60);
   if(error)throw error;
   if(tab){tab.opener=null;tab.location.replace(data.signedUrl);}
   else toast('Дозвольте відкриття нового вікна для перегляду файлу');
  }catch(err){if(tab)tab.close();toast(err.message||String(err));}
  return;
 }
 if(a==='service-done'){if(!isOwner())return;return mutation(sb.from('fleet_service_events').update({completed_at:new Date().toISOString()}).eq('id',id));}if(a==='toggle-theme'){applyTheme(theme==='light'?'dark':'light');return;}if(a==='nav'){showMore=false;if(btn.dataset.page==='documents'&&isOwner())selectedDriverId=null;page=btn.dataset.page;render();window.scrollTo(0,0);return;}if(a==='more'){showMore=!showMore;render();return;}if(a==='auth-mode'){mode=btn.dataset.value;authNotice='';authNoticeIsError=false;render();return;}if(a==='change-password'){if(!user)return;setRecoveryMode(true);authNotice='';render();return;}if(a==='cancel-recovery'){setRecoveryMode(false);authNotice='';render();return;}if(a==='auth-method'||a==='auth-small-link'){authMethod=btn.dataset.value==='magic'?'magic':'password';authNotice='';authNoticeIsError=false;render();return;}if(a==='refresh'){await load();return;}if(a==='signout'){const {error}=await sb.auth.signOut();if(error)throw error;if(chatPresenceChannel){void sb?.removeChannel(chatPresenceChannel);chatPresenceChannel=null;chatPresenceUser=null;chatOnlineUsers=new Set();}user=null;currentAuthUserId=null;clearAccountState();setRecoveryMode(false);render();return;}if(a==='oauth'){if(!oauthEnabled[btn.dataset.provider]){authNotice=t('oauthNotReady');render();return;}try{const redirectTo=authRedirect;const {error}=await sb.auth.signInWithOAuth({provider:btn.dataset.provider,options:{redirectTo}});if(error)throw error;}catch(err){authNotice=t('oauthNotReady');toast(err.message||authNotice);render()}return;}if(a==='resend-confirm'){const email=(document.querySelector('#auth-form input[name="email"]')?.value||lastAuthEmail||'').trim();if(!email){toast(lang==='uk'?'Вкажіть email у формі вище.':'Enter your email in the form above.');return;}try{assertAuthEmailCooldown();btn.disabled=true;const {error}=await sb.auth.resend({type:'signup',email:String(email).trim().toLowerCase(),options:{emailRedirectTo:authRedirect}});if(error)throw error;markAuthEmailSent();authNoticeIsError=false;authNotice=lang==='uk'?'Якщо адреса очікує підтвердження, лист буде надіслано. Перевірте пошту й «Спам».':'If this address is awaiting confirmation, an email will be sent. Check your inbox and spam.';render();}catch(err){authNotice=authErrorMessage(err,'resend');authNoticeIsError=true;render();}finally{if(btn.isConnected)btn.disabled=false;}return;}if(!sb||!me)return;
 if(a==='select-repair'){currentRepair=id;page='repairs';render();return;}
 if(a==='voice-repair'){const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){toast(t('repairVoiceUnavailable'));return;}const speech=new SR();speech.lang=lang==='uk'?'uk-UA':'en-US';speech.interimResults=false;speech.maxAlternatives=1;speech.onresult=event=>{const input=document.getElementById('repair-voice-target');if(input)input.value=(input.value+' '+event.results[0][0].transcript).trim();};speech.onerror=()=>toast(t('repairVoiceUnavailable'));speech.start();return;}
 if(a==='confirm-payment'||a==='reject-payment'){if(!isOwner())return;const pay=records.payment_claims.find(p=>p.id===id);if(!pay||pay.status!=='declared')return;const proceed=window.confirm(`${t(a==='confirm-payment'?'confirmPayment':'rejectPayment')} · ${money(pay.amount)}?`);if(!proceed)return;const {error}=await sb.rpc('nikcar_decide_payment',{p_id:id,p_confirm:a==='confirm-payment',p_note:''});if(error)throw error;toast(t(a==='confirm-payment'?'confirmed':'rejected'));await load();return;}
 if(a==='post-repair'){if(!isOwner())return;const item=records.repair_jobs.find(x=>x.id===id);if(!item||item.status!=='draft')return;if(!window.confirm(`${t('repairPost')} · ${money(repairTotal(item))}?`))return;const {error,data}=await sb.rpc('nikcar_post_repair',{p_repair:id});if(error)throw error;toast(`${t('repairTotal')}: ${money(data)}`);await load();return;}
 if(a==='remove-part'){if(!isOwner())return;const item=records.repair_parts.find(x=>x.id===id);if(!item||records.repair_jobs.find(x=>x.id===item.repair_id)?.status!=='draft')return;await mutation(sb.from('repair_parts').delete().eq('id',id));return;} 
 if(a==='delete-car'){
  if(!isOwner())return;
  const car=records.cars.find(c=>String(c.id)===String(id));if(!car)return;
  if(car.status!=='free'){toast(lang==='uk'?'Спочатку завершіть оренду автомобіля.':'Finish the car rental first.');return;}
  const ok=window.confirm((lang==='uk'?'Видалити автомобіль ':'Delete vehicle ')+car.model+' · '+car.plate+'? '+(lang==='uk'?'Цю дію неможливо скасувати. Якщо є пов’язані записи, видалення буде заблоковано.':'This cannot be undone. Related records may prevent deletion.'));
  if(!ok)return;
  const {data:deleted,error}=await sb.from('cars').delete().eq('id',car.id).select('id');
  if(error){toast((lang==='uk'?'Не вдалося видалити: ':'Delete failed: ')+error.message);return;}
  if(!deleted?.some(row=>String(row.id)===String(car.id))){toast(lang==='uk'?'Автомобіль не видалено. Перевірте права доступу та оновіть сторінку.':'Vehicle was not deleted. Check permissions and refresh.');await load();return;}
  if(carEditor===car.id)carEditor=null;
  toast(lang==='uk'?'Автомобіль видалено':'Vehicle deleted');forceMutationRefresh++;await load();return;
 }
 if(a==='ai-ask'){if(!isOwner())return;aiQuestion=btn.dataset.question||'';aiAnswer=nikcarAiRespond(aiQuestion);render();return;}
 if(a==='clear-new-car'){if(!isOwner())return;clearNewCarForm();return;}
 if(a==='edit-car'){if(!isOwner())return;carEditor=id;page='cars';render();return;}
 if(a==='cancel-car-edit'){carEditor=null;render();return;}
 if(a==='driver-docs'){if(!isOwner())return;const driver=records.profiles.find(p=>p.id===id&&p.role==='driver');if(!driver)return;selectedDriverId=driver.id;page='documents';render();window.scrollTo(0,0);return;}if(a==='all-driver-docs'){if(!isOwner())return;selectedDriverId=null;page='documents';render();return;}
 if(a==='set-driver-access'){
  if(!isOwner())return;const sel=document.querySelector(`select[data-driver-id="${id}"]`);const desired=sel?.value;
  if(!desired)return;
  return mutation(sb.rpc('nikcar_owner_set_driver_access',{target_driver_id:id,target_access:desired}),t('applyAccess'));
 }
 if(a==='delete-announcement'){
  if(!isOwner()||!window.confirm(t('removeNews')+'?'))return;
  return mutation(sb.from('announcements').delete().eq('id',id));
 }
 if(a==='copy-announcement'){
  const article=records.announcements.find(x=>x.id===id);if(!article)return;
  try{await navigator.clipboard.writeText(`${article['title_'+lang]}\n\n${article['body_'+lang]}\n\nNikCar`);toast(t('copyText'))}catch(err){toast(err.message||String(err))}return;
 }
 if(a==='choose-car'){selectedCar=id;page='documents';render();window.scrollTo(0,0);return;}
 if(a==='submit-doc-choice'){if(!selectedCar||!hasLocalDocs(selectedCar)){toast(t('docsMissing'));return;}return mutation(sb.from('rental_requests').insert({car_id:selectedCar,driver_id:me.id}),t('pending'));}
 if(a==='open-doc'){const doc=records.driver_documents.find(d=>d.id===id);if(!doc)return;const tab=window.open('about:blank','_blank');try{const {data,error}=await sb.storage.from('nikcar-driver-docs').createSignedUrl(doc.object_path,60);if(error)throw error;if(tab){tab.opener=null;tab.location.replace(data.signedUrl);}else toast(lang==='uk'?'Дозвольте відкриття нового вікна для фото':'Allow pop-ups to view the photo');}catch(err){if(tab)tab.close();toast(err.message||String(err));}return;}
 if(a==='approve-request'||a==='reject-request'){return mutation(sb.from('rental_requests').update({status:a==='approve-request'?'approved':'rejected'}).eq('id',id).eq('status','pending').select(),t(a==='approve-request'?'approved':'rejected'));}
 if(a==='handover-rental'||a==='return-rental'){
  if(!isOwner())return;
  const request=records.rental_requests.find(x=>x.id===id);
  if(!request||request.status!=='approved')return;
  const handing=a==='handover-rental';
  const title=handing?(lang==='uk'?'Пробіг при видачі, км':'Odometer at handover, km'):(lang==='uk'?'Пробіг при поверненні, км':'Odometer at return, km');
  const input=window.prompt(title,handing?'':String(request.odometer_out_km??''));
  if(input===null)return;
  const raw=String(input).trim(),odometer=Number(raw);
  if(!/^\\d+$/.test(raw)||!Number.isSafeInteger(odometer)||odometer<0||odometer>3000000||(!handing&&odometer<Number(request.odometer_out_km))){
   toast(lang==='uk'?'Введіть коректний пробіг у кілометрах.':'Enter a valid odometer reading in kilometres.');return;
  }
  if(!window.confirm(handing?(lang==='uk'?'Підтвердіть: бак ПОВНИЙ, авто та ключі передані водію.':'Confirm: fuel tank FULL, vehicle and keys handed to driver.'):(lang==='uk'?'Підтвердіть: бак ПОВНИЙ, авто та ключі повернуті власнику.':'Confirm: fuel tank FULL, vehicle and keys returned to owner.')))return;
  const note=window.prompt(lang==='uk'?'Примітка до акту (необов’язково)':'Handover/return note (optional)','');
  if(note===null)return;
  const fn=handing?'nikcar_handover_rental':'nikcar_return_rental';
  return mutation(sb.rpc(fn,{p_request:id,p_odometer:odometer,p_full_tank:true,p_note:String(note).slice(0,2000)}),handing?(lang==='uk'?'Авто видано':'Vehicle handed over'):(lang==='uk'?'Авто повернуто':'Vehicle returned'));
 }
 if(a==='cancel-request'){return mutation(sb.from('rental_requests').update({status:'cancelled'}).eq('id',id).eq('status','pending').eq('driver_id',me.id).select(),t('cancelled'));}
 const r=records.sos_requests.find(x=>x.id===id);if(!r)return;
 if(a==='claim-sos'){return mutation(sb.from('sos_requests').update({status:'claimed',helper_id:me.id}).eq('id',id).eq('status','open').is('helper_id',null).select(),t('claimed'));}
 if(a==='release-sos'){return mutation(sb.from('sos_requests').update({status:'open',helper_id:null,resolved_at:null}).eq('id',id).eq('status','claimed').eq('helper_id',me.id).select(),t('open'));}
 if(a==='finish-sos'){return mutation(sb.from('sos_requests').update({status:'resolved',resolved_at:new Date().toISOString()}).eq('id',id).eq('status','claimed').eq('helper_id',me.id).select(),t('resolved'));}
 if(a==='cancel-sos'){return mutation(sb.from('sos_requests').update({status:'cancelled'}).eq('id',id).eq('status','open').eq('requester_id',me.id).select(),t('cancelled'));}
}
document.addEventListener('click',evt=>{
 const b=evt.target.closest('button[data-action]');
 if(!b)return;
 const action=b.dataset.action,key=(actionGroups[action]||action)+':'+(b.dataset.id||'');
 if(isOffline()&&protectedActions.has(action)){toast(offlineMessage());return;}
 if(!protectedActions.has(action)){void clickAction(b).catch(err=>toast(err.message||err));return;}
 if(inFlightActions.has(key))return;
 inFlightActions.add(key);b.disabled=true;
 void clickAction(b).catch(err=>toast(err.message||err)).finally(()=>{
  inFlightActions.delete(key);
  if(b.isConnected)b.disabled=false;
 });
});
document.addEventListener('change',async evt=>{
 const f=evt.target;
 if(f.id==='document-car'){selectedCar=f.value||null;render();return;}
 if(!f.matches('input[type="file"][data-doc-kind]'))return;
 const file=f.files?.[0],kind=f.dataset.docKind,car=f.dataset.car||null;
 if(!file||docBusy)return;
 if(isOffline()){toast(offlineMessage());return;}
 if(!me||me.role!=='driver'||!canApply()){toast(t('notApproved'));return;}
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>6291456||file.size===0){toast(t('docLimit'));return;}
 if(kind==='rental_contract'&&!car){toast(t('selectFirst'));return;}
 const ext=file.type==='image/png'?'png':file.type==='image/webp'?'webp':'jpg';
 const fileId=crypto.randomUUID();
 const authUserId=user.id,driverProfileId=me.id;
 const path=`${authUserId}/${kind}/${kind==='rental_contract'?car+'/':''}${fileId}.${ext}`;
 let uploaded=false;
 docBusy=true; f.disabled=true;
 try{
   const {error:uploadError}=await sb.storage.from('nikcar-driver-docs').upload(path,file,{cacheControl:'0',upsert:false,contentType:file.type});
   if(uploadError)throw uploadError;
   uploaded=true;
   if(isOffline())throw new Error(offlineMessage());
   if(user?.id!==authUserId||me?.id!==driverProfileId)throw new Error(lang==='uk'?'Акаунт змінився під час завантаження. Повторіть спробу.':'Account changed during upload. Please try again.');
   const old=docFor(kind,driverProfileId,kind==='rental_contract'?car:null);
   const query=old?sb.from('driver_documents').update({object_path:path}).eq('id',old.id):sb.from('driver_documents').insert({driver_id:driverProfileId,car_id:kind==='rental_contract'?car:null,kind,object_path:path});
   const {error:saveError}=await query;
   if(saveError)throw saveError;
   toast(t('docUploadDone'));await load();
 }catch(error){
    if(uploaded){
     // Only a just-uploaded, unlinked file may be removed. Database RLS protects linked files.
     try{
      const {error:cleanupError}=await sb.storage.from('nikcar-driver-docs').remove([path]);
      if(cleanupError)throw cleanupError;
     }catch(_cleanupError){
      toast(lang==='uk'?'Не вдалося завершити завантаження. Файл міг залишитися без прив’язки; повідомте адміністратора та оновіть сторінку.':'Upload could not be completed. An unlinked file may remain; contact the administrator and refresh.');
      return;
     }
    }
    toast(error.message||String(error));
 }
 finally{docBusy=false;f.disabled=false;}
});
document.addEventListener('change',evt=>{if(evt.target.id==='tech-passport-photo'&&evt.target.files?.[0])void readTechPassport(evt.target.files[0]);});
document.addEventListener('input',evt=>{const form=evt.target.closest?.('form');if(form)form.dataset.dirty='1';if(form?.id==='new-car')captureNewCarDraft();if(evt.target.id==='driver-filter'){const needle=evt.target.value.toLowerCase().trim();document.querySelectorAll('.driver-card').forEach(el=>{el.hidden=!(el.dataset.search||'').includes(needle)})}});
document.addEventListener('change',evt=>{const form=evt.target.closest?.('form');if(form)form.dataset.dirty='1';if(evt.target.matches('select[data-action="language"]')){lang=evt.target.value==='en'?'en':'uk';localStorage.setItem('nikcar-lang',lang);render();}});
document.addEventListener('submit',async evt=>{const form=evt.target;if(!['auth-form','new-car','edit-car-form','announcement-form','chat-send','sos-create','profile-update','cash-payment-form','repair-create','repair-add-part','new-password-form','service-event','fleet-inspection-form','fleet-file-form','fleet-damage-ai-form','nikcar-ai-question'].includes(form.id))return;evt.preventDefault();if(form.dataset.submitting==='1')return;form.dataset.submitting='1';const submitBtn=form.querySelector('button[type="submit"]');if(submitBtn)submitBtn.disabled=true;const f=new FormData(form);try{
 if(isOffline())throw new Error(offlineMessage());
 if(form.id==='auth-form'){const email=String(f.get('email')||'').trim().toLowerCase(),password=String(f.get('password')||'');lastAuthEmail=email;
  if(mode==='reset'){assertAuthEmailCooldown();const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:authRedirect});if(error)throw error;markAuthEmailSent();authNoticeIsError=false;authNotice=lang==='uk'?'Якщо адреса зареєстрована, лист для відновлення надіслано. Перевірте «Спам».':'If this address is registered, a recovery link has been sent. Check spam too.';render();return;}
  if(mode==='signup'){const repeated=String(f.get('confirm_password')||'');if(password.length<10||password.length>128)throw Error(lang==='uk'?'Пароль повинен містити 10–128 символів.':'Password must have 10–128 characters.');if(password!==repeated)throw Error(lang==='uk'?'Паролі не збігаються.':'Passwords do not match.');assertAuthEmailCooldown();const {data,error}=await sb.auth.signUp({email,password,options:{emailRedirectTo:authRedirect,data:{full_name:String(f.get('fullname')||'').trim()}}});if(error)throw error;markAuthEmailSent();authNoticeIsError=false;authNotice=data?.session?(lang==='uk'?'Обліковий запис створено.':'Account created.'):(lang==='uk'?'Якщо реєстрація можлива, ви отримаєте лист підтвердження. Перевірте «Спам».':'If registration is available, you will receive a confirmation email. Check spam too.');mode='signin';render();return;}
  if(mode==='signin'&&authMethod==='magic'){assertAuthEmailCooldown();const {error}=await sb.auth.signInWithOtp({email,options:{emailRedirectTo:authRedirect,shouldCreateUser:false}});if(error)throw error;markAuthEmailSent();authNoticeIsError=false;authNotice=lang==='uk'?'Якщо акаунт існує, лист для входу надіслано. Перевірте пошту.':'If the account exists, a sign-in email has been sent. Check your inbox.';render();return;}
  const {error}=await sb.auth.signInWithPassword({email,password});if(error)throw error;return;}
 if(form.id==='new-password-form'){
  const pw=String(f.get('password')||''),pw2=String(f.get('confirm_password')||'');
  if(pw.length<10||pw.length>128)throw Error(lang==='uk'?'Пароль повинен містити 10–128 символів.':'Password must have 10–128 characters.');
  if(pw!==pw2)throw Error(lang==='uk'?'Паролі не збігаються.':'Passwords do not match.');
  const {error}=await sb.auth.updateUser({password:pw});
  if(error)throw error;
  // Changing the password does not guarantee that the existing session was closed.
  // Do not claim a successful logout unless Supabase explicitly confirms it.
  let logoutError;
  try{const result=await sb.auth.signOut();logoutError=result?.error||null;}
  catch(err){logoutError=err;}
  if(logoutError){
   authNoticeIsError=true;
   authNotice=lang==='uk'?'Пароль змінено, але завершити сеанс не вдалося. Скористайтеся кнопкою «Вийти з акаунта» та перевірте підключення.':'Password changed, but signing out failed. Use the Sign out button and check your connection.';
   render();
   return;
  }
  if(chatPresenceChannel){void sb?.removeChannel(chatPresenceChannel);chatPresenceChannel=null;chatPresenceUser=null;chatOnlineUsers=new Set();}user=null;currentAuthUserId=null;clearAccountState();setRecoveryMode(false);
  mode='signin';authNoticeIsError=false;authNotice=t('authRecoverDone');render();return;
 }
 if(form.id==='cash-payment-form'){if(!canApply())return;const rentalId=String(f.get('rental')||'');if(!records.rental_requests.some(r=>r.id===rentalId&&r.driver_id===me.id&&r.status==='approved'))throw Error(t('noApprovedRental'));const amount=Number(f.get('amount'));if(!(amount>0&&amount<=1000000))throw Error(t('amount'));if(!window.confirm(t('paymentHint')))return;await mutation(sb.from('payment_claims').insert({driver_id:me.id,rental_request_id:rentalId,method:f.get('method'),amount,driver_note:String(f.get('note')||'').trim()}),t('declared'));return;}
 if(form.id==='nikcar-ai-question'){if(!isOwner())return;aiQuestion=String(f.get('question')||'').trim();aiAnswer=nikcarAiRespond(aiQuestion);render();return;}
 if(form.id==='fleet-damage-ai-form'){
  if(!isOwner())return;
  const before_file_id=String(f.get('before_file_id')),after_file_id=String(f.get('after_file_id'));
  const photos=records.fleet_files.filter(x=>x.id===before_file_id||x.id===after_file_id);
  if(before_file_id===after_file_id||photos.length!==2||photos[0].car_id!==photos[1].car_id)throw Error('Оберіть два різні фото одного автомобіля');
  if(!photos.every(p=>['damage_photo','inspection_photo'].includes(p.kind)&&/\.(jpg|jpeg|png|webp)$/i.test(p.object_path)))throw Error('Оберіть два фото JPG, PNG або WebP');
  const {data,error}=await sb.functions.invoke('nikcar-damage-ai',{body:{car_id:photos[0].car_id,before_file_id,after_file_id}});
  if(error){const details=error.context?.json?await error.context.json().catch(()=>null):null;throw Error(details?.message||details?.error||error.message||'Помилка ІІ');}
  if(data?.error)throw Error(data.message||data.error);
  toast('Попередній ІІ-висновок збережено. Перевірте його вручну.');await load();return;
 }
 if(form.id==='fleet-inspection-form'){
  if(!isOwner())return;
  const states=['ok','attention','critical','unknown'],entry={car_id:String(f.get('car_id'))};
  for(const k of ['engine','brakes','tires','body']){entry[k]=String(f.get(k));if(!states.includes(entry[k]))throw Error('Некоректна оцінка стану');}
  const km=String(f.get('odometer_km')||'').trim();
  entry.odometer_km=km?Number(km):null;entry.notes=String(f.get('notes')||'').trim();
  const {error}=await sb.from('fleet_inspections').insert(entry);if(error)throw error;
  ownerUiDrafts.delete(user.id+':fleet-inspection-form');form.reset();await load();return;
 }
 if(form.id==='fleet-file-form'){
  if(!isOwner())return;
  const file=f.get('file'),kind=String(f.get('kind')),car_id=String(f.get('car_id')),title=String(f.get('title')||'').trim();
  const types={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','application/pdf':'pdf'};
  if(!file||!types[file.type]||!file.size||file.size>15728640)throw Error('Дозволені JPG, PNG, WebP, PDF до 15 МБ');
  if(['damage_photo','inspection_photo'].includes(kind)&&file.type==='application/pdf')throw Error('Для фотоогляду завантажте JPG, PNG або WebP, а не PDF');
  if(!['contract','handover_act','return_act','damage_photo','inspection_photo','other'].includes(kind))throw Error('Некоректний тип документа');
  if(title.length<2||title.length>160)throw Error('Вкажіть назву документа');
  const path=user.id+'/'+car_id+'/'+crypto.randomUUID()+'.'+types[file.type];
  const authId=user.id;
  const {error:uploadError}=await sb.storage.from('nikcar-fleet-private').upload(path,file,{upsert:false,contentType:file.type});
  if(uploadError)throw uploadError;
  try{
   if(user?.id!==authId)throw Error('Акаунт змінився під час завантаження');
   const {error}=await sb.from('fleet_files').insert({car_id,kind,title,object_path:path});
   if(error)throw error;
  }catch(err){
   try{await sb.storage.from('nikcar-fleet-private').remove([path]);}catch(_){}
   throw err;
  }
  ownerUiDrafts.delete(user.id+':fleet-file-form');form.reset();await load();return;
 }
 if(form.id==='service-event'){
  if(!isOwner())return;
  const due_date=String(f.get('due_date')||'').trim();
  const dueKm=String(f.get('due_odometer_km')||'').trim();
  const currentKm=String(f.get('current_odometer_km')||'').trim();
  if(!due_date&&!dueKm)throw Error('Вкажіть дату або пробіг');
  const {error}=await sb.from('fleet_service_events').insert({
   car_id:String(f.get('car_id')),kind:String(f.get('kind')),
   title:String(f.get('title')||'').trim(),due_date:due_date||null,
   due_odometer_km:dueKm?Number(dueKm):null,current_odometer_km:currentKm?Number(currentKm):null,
   notes:String(f.get('notes')||'').trim()
  });
  if(error)throw error;ownerUiDrafts.delete(user.id+':service-event');form.reset();await load();return;
 }
 if(form.id==='repair-create'){if(!isOwner())return;const title=String(f.get('title')||'').trim(),vin=String(f.get('vin')||'').trim().toUpperCase(),labor=Number(f.get('labor'));if(vin&&!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin))throw Error(t('repairVIN'));const {data,error}=await sb.from('repair_jobs').insert({car_id:String(f.get('car')),title,vin:vin||null,symptoms:String(f.get('symptoms')||'').trim(),labor_cost:labor,created_by:me.id}).select('id').single();if(error)throw error;currentRepair=data.id;toast(t('repairCreate'));await load();return;}
 if(form.id==='repair-add-part'){if(!isOwner()||!currentRepair)return;const job=records.repair_jobs.find(j=>j.id===currentRepair);if(!job||job.status!=='draft')return;const price=Number(f.get('unit_price')),qty=Number(f.get('qty'));if(!Number.isFinite(price)||price<0||!Number.isFinite(qty)||qty<=0)throw Error(t('repairPrice'));await mutation(sb.from('repair_parts').insert({repair_id:currentRepair,item_name:String(f.get('item')||'').trim(),article:String(f.get('article')||'').trim(),supplier:String(f.get('supplier')||'').trim(),supplier_url:String(f.get('url')||'').trim(),quantity:qty,unit_price:price}));return;}
 if(form.id==='announcement-form'){
  if(!isOwner())return;await mutation(sb.from('announcements').insert({author_id:me.id,title_uk:String(f.get('title_uk')||'').trim(),title_en:String(f.get('title_en')||'').trim(),body_uk:String(f.get('body_uk')||'').trim(),body_en:String(f.get('body_en')||'').trim(),pinned:f.get('pinned')==='on'}));return;
 }
 if(form.id==='edit-car-form'){
  if(!isOwner())return;const carId=String(f.get('id')||'');
  const saved=await mutation(sb.from('cars').update({plate:String(f.get('plate')||'').trim().toUpperCase(),model:String(f.get('model')||'').trim(),year:f.get('year')?Number(f.get('year')):null,daily_rate:Number(f.get('rate'))}).eq('id',carId));if(saved){carEditor=null;render();}return;
 }
 if(form.id==='new-car'){const {error}=await sb.from('cars').insert({plate:String(f.get('plate')).trim().toUpperCase(),model:String(f.get('model')).trim(),year:f.get('year')?Number(f.get('year')):null,daily_rate:Number(f.get('rate'))});if(error){toast(error.message);return;}/* Clear draft BEFORE load/render: the old mutation() refreshed the page and re-captured saved fields. */clearNewCarForm();const ocrStatus=document.getElementById('tech-passport-status');if(ocrStatus)ocrStatus.textContent='Автомобіль збережено. Форма готова до наступного додавання.';toast(lang==='uk'?'Автомобіль додано':'Car added');forceMutationRefresh++;await load();return;}
 if(form.id==='chat-send'){await mutation(sb.from('chat_messages').insert({sender_id:me.id,body:String(f.get('text')).trim()}));return;}
 if(form.id==='sos-create'){await mutation(sb.from('sos_requests').insert({requester_id:me.id,category:f.get('category'),note:String(f.get('note')||'').trim(),location_text:String(f.get('location')||'').trim()}));return;}
 if(form.id==='profile-update'){await mutation(sb.from('profiles').update({full_name:String(f.get('fullname')||'').trim(),phone:String(f.get('phone')||'').trim()}).eq('id',me.id));return;}
 }catch(err){if(form.id==='auth-form'||form.id==='new-password-form'){const op=form.id==='auth-form'?(mode==='reset'?'reset':mode==='signup'?'signup':mode==='signin'&&authMethod==='magic'?'magic':''):'';authNotice=authErrorMessage(err,op);authNoticeIsError=true;if(isOffline())toast(authNotice);else render();}else toast(err.message||err);}finally{if(form.isConnected){form.dataset.submitting='0';if(submitBtn)submitBtn.disabled=false;}}});
(async()=>{if(!configured){render();return;}try{
 const mod=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
 sb=mod.createClient(cfg.url,cfg.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
 // Subscribe FIRST: Supabase can emit PASSWORD_RECOVERY while processing the URL/session.
 sb.auth.onAuthStateChange((event,s)=>{
  const nextUser=s?.user||null,nextId=nextUser?.id||null;
  if(nextId!==currentAuthUserId){clearAccountState();currentAuthUserId=nextId;}
  user=nextUser;
  if(event==='PASSWORD_RECOVERY')setRecoveryMode(true);
  if(event==='SIGNED_OUT')setRecoveryMode(false);
  if(event!=='INITIAL_SESSION')setTimeout(()=>load(),0);
 });
 const {data:{session},error}=await sb.auth.getSession();
 if(error)throw error;
 const initialId=session?.user?.id||null;
 if(initialId!==currentAuthUserId){clearAccountState();currentAuthUserId=initialId;}
 user=session?.user||null;
 if(!user&&recoveryMode){setRecoveryMode(false);mode='reset';authNotice=lang==='uk'?'Посилання відновлення недійсне або термін його дії минув. Запитайте новий лист.':'Recovery link is invalid or expired. Request a new email.';}
 await load();
 void checkOAuthAvailability();
 for(const table of ['chat_messages','sos_requests','rental_requests','announcements','payment_claims','repair_jobs'])
  sb.channel(`nikcar-${table}`).on('postgres_changes',{event:'*',schema:'public',table},()=>{if(user&&!recoveryMode)void load({preserveDraft:true});}).subscribe();
 }catch(err){root.innerHTML=`<div class="auth-layout"><div class="auth-box"><h1>${t('systemError')}</h1><p>${e(err.message||err)}</p></div></div>`;}})();