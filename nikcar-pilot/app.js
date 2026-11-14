/* NikCar Cloud Console v0.9 — online pilot; restricted operations.
   Production rental accounting/inspections/finance stay in original DEMO until migrated and tested. */
const root=document.getElementById('root');
const photoUrlCache=new Map();
const PHOTO_URL_TTL_MS=50*60*1000;
const PHOTO_URL_CACHE_LIMIT=180;
const photoUrlInFlight=new Map();
async function hydratePrivatePhotos(){
 if(!sb)return;
 const images=[...document.querySelectorAll('img[data-photo-path]')];
 // Avoid dozens of concurrent signed-URL requests on older iPhones.
 const pending=images.filter(img=>img.dataset.photoPath);
 const worker=async()=>{
  while(pending.length){
   const img=pending.shift(),path=img.dataset.photoPath;
   if(!img.isConnected)continue;
   try{
    let entry=photoUrlCache.get(path);
    let url=entry&&entry.expiresAt>Date.now()?entry.url:null;
    if(!url){let pendingUrl=photoUrlInFlight.get(path);if(!pendingUrl){pendingUrl=(async()=>{const result=await sb.storage.from('nikcar-photos').createSignedUrl(path,3600);if(result.error)throw result.error;const signedUrl=result.data.signedUrl;photoUrlCache.set(path,{url:signedUrl,expiresAt:Date.now()+PHOTO_URL_TTL_MS});if(photoUrlCache.size>PHOTO_URL_CACHE_LIMIT)photoUrlCache.delete(photoUrlCache.keys().next().value);return signedUrl;})();photoUrlInFlight.set(path,pendingUrl);pendingUrl.finally(()=>{if(photoUrlInFlight.get(path)===pendingUrl)photoUrlInFlight.delete(path);}).catch(()=>{});}url=await pendingUrl;}
    if(img.isConnected&&img.dataset.photoPath===path)img.src=url;
   }catch(err){console.warn('Photo unavailable',err);}
  }
 };
 await Promise.all(Array.from({length:Math.min(3,pending.length)},()=>worker()));
}
async function uploadFleetPhoto(file,path){
 if(!file)return null;
 if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Підтримуються JPG, PNG або WebP');
 if(file.size>5*1024*1024)throw Error('Фото має бути до 5 МБ');
 const {error}=await sb.storage.from('nikcar-photos').upload(path,file,{contentType:file.type,upsert:true});
 if(error)throw error;photoUrlCache.delete(path);return path;
}
async function uploadFleetPhotoWithRetry(file,path){let error;for(let attempt=0;attempt<2;attempt++){try{return await uploadFleetPhoto(file,path);}catch(err){error=err;if(attempt===0)console.warn('Retrying photo upload:',path,err.message);}}throw error;}
function photoExt(file){return file.type==='image/png'?'png':file.type==='image/webp'?'webp':'jpg';}
function privatePhoto(path,cls,alt,fallback){return path?'<img class="'+cls+'" data-photo-path="'+e(path)+'" src="'+fallback+'" alt="'+e(alt)+'" loading="lazy">':'<img class="'+cls+'" src="'+fallback+'" alt="'+e(alt)+'" loading="lazy">';}

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
 uk:{cars:'Автопарк',requests:'Заявки',chat:'Чат',sos:'SOS',documents:'Документи',account:'Профіль',signout:'Вийти',signin:'Увійти',signup:'Реєстрація',reset:'Відновити пароль',email:'Електронна пошта',password:'Пароль',fullname:'Ім’я та прізвище',create:'Створити обліковий запис',login:'Увійти до NikCar',google:'Увійти через Google',apple:'Увійти через Apple',forgot:'Забули пароль?',registerInfo:'Спочатку виберіть авто та додайте всі 5 документів. Лише після цього можна надіслати заявку власнику.',notConnected:'Хмарний сервер ще не підключено',setup:'Заповніть web/config.js адресою і публічним ключем тестового проєкту Supabase та застосуйте SQL-міграцію. Паролі й фінансові дані не вводьте до перевірки RLS.',cloudPilot:'Хмарний пілот',role:'Роль',access:'Доступ',candidate:'Кандидат',active:'Активний',archived:'Архів',blocked:'Заблоковано',owner:'Власник',driver:'Водій',free:'Вільний',reserved:'Резерв',rented:'В оренді',maintenance:'Сервіс',model:'Модель',plate:'Держномер',year:'Рік',rate:'Оренда за тиждень, грн',saveCar:'Додати авто',apply:'Подати заявку',approve:'Схвалити',reject:'Відхилити',cancel:'Скасувати',pending:'Очікує',approved:'Схвалено',rejected:'Відхилено',cancelled:'Скасовано',requestTitle:'Заявки на оренду',requestInfo:'Схвалення заявки НЕ означає видачу автомобіля; фотоакт і передача ключів ще не підключені.',noRequests:'Заявок поки немає',noCars:'Автомобілів поки немає',unknown:'Невідомо',saveProfile:'Зберегти профіль',phone:'Телефон',chatTitle:'Загальний чат водіїв',chatInfo:'Доступний власнику та активним водіям. Фото й відео з приватного сховища додамо окремо.',message:'Повідомлення',send:'Надіслати',noChat:'Повідомлень ще немає',restricted:'Доступ відкриється після фактичної видачі автомобіля.',sosTitle:'Взаємодопомога водіїв',sosInfo:'Водії самі беруть заявки. Власник не призначає помічників.',sosType:'Яка допомога потрібна?',jump_start:'Прикурити',tow:'Дотягнути / евакуатор',wheel:'Колесо',other:'Інше',location:'Місце або орієнтир',description:'Опис проблеми',createSos:'Надіслати SOS',claim:'Їду допомагати',release:'Не можу допомогти',complete:'Допомога надана',noSos:'Заявок SOS поки немає',open:'Шукає допомогу',claimed:'Помічник їде',resolved:'Завершено',date:'Дата',deleteNotice:'Архівування після повернення авто, фінансовий облік і видалення облікового запису будуть реалізовані в наступних серверних міграціях.',noPayments:'АЗС і Fuel Points ще вимкнені. Оплата готівкою/переказом — лише після підтвердження власником.',authWait:'Перевірте електронну пошту для підтвердження, якщо це вимагають налаштування Supabase.',loginHint:'Електронна пошта, Google або Apple. Провайдери Google/Apple запрацюють лише після налаштування в Supabase.',onlyPilot:'ТЕСТОВИЙ ПІЛОТ · Не завантажуйте справжні документи до завершення аудиту доступу',retry:'Оновити',lang:'Мова',empty:'Немає даних',you:'Ви',driverProfile:'Профіль водія',allRequests:'Заявки всіх водіїв',myRequests:'Мої заявки',carPrice:'грн/доба',newCar:'Новий автомобіль',helper:'Помічник',reload:'Оновити',emailSent:'Лист відправлено, якщо адресу зареєстровано',soon:'Модуль буде перенесено після серверних тестів',cancelSos:'Скасувати SOS',notApproved:'Доступ до чату й SOS можливий лише для активних водіїв.',notFound:'Профіль не знайдено. Перевірте тригер реєстрації.',accountState:'Обліковий запис',logout:'Вийти',systemError:'Помилка сервера',docsTitle:'Документи водія',docsInfo:'Завантажте фото сторінок 1, 2, 3 паспорта, ІПН та підписаного договору оренди на обране авто. Усі 5 фото обов’язкові перед надсиланням заявки.',docsPrivacy:'Файли приватні: доступ маєте лише ви та власник NikCar. Не надсилайте їх у загальний чат.',passport_1:'Паспорт — сторінка 1',passport_2:'Паспорт — сторінка 2',passport_3:'Паспорт — сторінка 3',tax_id:'ІПН / РНОКПП',rental_contract:'Фото підписаного договору оренди',docsDone:'Документи додані',docsMissing:'Завантажте всі 5 фото перед заявкою',upload:'Завантажити фото',openDocument:'Переглянути',chooseCar:'Обрати авто',selectFirst:'Спочатку виберіть автомобіль',submitCar:'Завершити вибір і надіслати заявку',selectedCar:'Вибраний автомобіль',docsWaiting:'Потрібні документи',docLimit:'Максимальний розмір фото — 6 МБ. Дозволені JPG, PNG, WebP.',docUploadDone:'Документ збережено',docOwnerView:'Документи водіїв',docOwnerNote:'Лише власник може переглядати документи інших водіїв. Перевіряйте відповідність документів до видачі авто.'},
 en:{cars:'Fleet',requests:'Requests',chat:'Chat',sos:'SOS',documents:'Documents',account:'Account',signout:'Sign out',signin:'Sign in',signup:'Sign up',reset:'Reset password',email:'Email',password:'Password',fullname:'Full name',create:'Create account',login:'Sign in to NikCar',google:'Continue with Google',apple:'Continue with Apple',forgot:'Forgot password?',registerInfo:'Choose a car, upload all five documents, then send your request to the owner.',notConnected:'Cloud server is not connected yet',setup:'Fill web/config.js with your Supabase TEST project URL and publishable key, then apply the SQL migration. Do not enter real financial or personal data before an RLS audit.',cloudPilot:'Cloud pilot',role:'Role',access:'Access',candidate:'Candidate',active:'Active',archived:'Archived',blocked:'Blocked',owner:'Owner',driver:'Driver',free:'Available',reserved:'Reserved',rented:'Rented',maintenance:'Maintenance',model:'Model',plate:'Plate',year:'Year',rate:'Daily rate',saveCar:'Add vehicle',apply:'Request vehicle',approve:'Approve',reject:'Reject',cancel:'Cancel',pending:'Pending',approved:'Approved',rejected:'Rejected',cancelled:'Cancelled',requestTitle:'Rental requests',requestInfo:'Approving a request does NOT hand over a vehicle; photo inspection and key handover are not connected yet.',noRequests:'No requests yet',noCars:'No vehicles yet',unknown:'Unknown',saveProfile:'Save profile',phone:'Phone',chatTitle:'Fleet group chat',chatInfo:'Only active drivers and the owner can access. Private photo/video storage will follow.',message:'Message',send:'Send',noChat:'No messages yet',restricted:'Access opens only after a vehicle has actually been handed over.',sosTitle:'Driver mutual assistance',sosInfo:'Drivers claim SOS calls themselves; the owner does not assign helpers.',sosType:'Help needed',jump_start:'Jump start',tow:'Tow / recovery',wheel:'Flat tire',other:'Other',location:'Location or landmark',description:'Problem details',createSos:'Send SOS',claim:'I can help',release:'Cannot help',complete:'Help completed',noSos:'No SOS requests yet',open:'Awaiting help',claimed:'Help on the way',resolved:'Resolved',date:'Date',deleteNotice:'Archiving on car return, financial records and account-deletion requests will be added in the next reviewed server migrations.',noPayments:'Fuel station and Fuel Points are disabled. Cash/card payment reports need owner confirmation.',authWait:'Check email to confirm registration if required by your Supabase settings.',loginHint:'Email, Google or Apple. Google/Apple require setup in Supabase before they will work.',onlyPilot:'TEST PILOT · Do not upload real identity documents until access controls are audited',retry:'Refresh',lang:'Language',empty:'No data',you:'You',driverProfile:'Driver profile',allRequests:'All requests',myRequests:'My requests',carPrice:'UAH/day',newCar:'New vehicle',helper:'Helper',reload:'Refresh',emailSent:'Email sent if the account exists',soon:'This module will move after server tests',cancelSos:'Cancel SOS',notApproved:'Chat and SOS are for active drivers only.',notFound:'Profile missing. Check your registration trigger.',accountState:'Account',logout:'Sign out',systemError:'Server error',docsTitle:'Driver documents',docsInfo:'Upload photos of passport pages 1, 2, 3, tax ID and the signed rental agreement for the selected car. All five photos are required before submitting a request.',docsPrivacy:'Private files: only you and NikCar’s owner can access them. Never share identity documents in group chat.',passport_1:'Passport — page 1',passport_2:'Passport — page 2',passport_3:'Passport — page 3',tax_id:'Tax identification number',rental_contract:'Photo of signed rental agreement',docsDone:'Documents saved',docsMissing:'Upload all five photos before applying',upload:'Upload photo',openDocument:'View',chooseCar:'Choose car',selectFirst:'First select a car',submitCar:'Complete vehicle selection and apply',selectedCar:'Selected car',docsWaiting:'Documents required',docLimit:'Maximum photo size: 6 MB. JPG, PNG, WebP only.',docUploadDone:'Document saved',docOwnerView:'Driver documents',docOwnerNote:'Only the owner may inspect other drivers’ documents. Review them before handing over the car.'}
};
let selectedCar=null, docBusy=false, lastAuthEmail='';
let lang=localStorage.getItem('nikcar-lang')==='en'?'en':'uk',page='cars',mode='signin',authMethod='password',authNotice=initialLinkError?initialLinkErrorMessage():'',recoveryMode=!initialLinkError&&(initialRecoveryLink||readRecoveryPending());
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
const UA_LABELS={points:'Пальне',settings:'Налаштування','days-off':'Вихідні', 'nikcar-ai':'ШІ NikCar'};const t=k=>UA_LABELS[k]||ADDITIONS.uk?.[k]||UICONSOLE.uk?.[k]||TRANSLATIONS.uk?.[k]||k;
const e=s=>String(s??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const d=x=>x?new Date(x).toLocaleString(lang==='uk'?'uk-UA':'en-GB',{dateStyle:'short',timeStyle:'short'}):'—';
const money=x=>Number(x||0).toLocaleString(lang==='uk'?'uk-UA':'en-GB')+' ₴';
const emptyRecords=()=>({driver_days_off:[],days_off_notifications:[],cars:[],rental_requests:[],chat_messages:[],sos_requests:[],profiles:[],driver_documents:[],announcements:[],payment_claims:[],repair_jobs:[],nikcar_service_tickets:[],nikcar_service_photos:[],repair_parts:[],expense_entries:[],fleet_service_events:[],fleet_files:[],fleet_inspections:[],fleet_damage_reviews:[],fleet_tracking_assets:[],fleet_fines:[],rental_damage_photos:[],fleet_fuel_price:[],fleet_fuel_price_history:[],driver_days_off:[],days_off_notifications:[]});
let sb=null,user=null,me=null,records=emptyRecords();
const driverTabs=[['cars','🚙'],['announcements','◉'],['requests','▤'],['rent-debts','📊'],['payments','₴'],['sto','⚒'],['points','⛽'],['notifications','🔔'],['documents','📄'],['chat','💬'],['sos','🆘'],['account','◯']];
const ownerTabs=[['dashboard','⌂'],['nikcar-ai','✦'],['tracking','⌖'],['cars','🚙'],['drivers','♙'],['requests','▤'],['payments','₴'],['points','⛽'],['notifications','🔔'],['settings','⚙'],['repairs','⚒'],['sto','🔧'],['documents','📄'],['announcements','◉'],['chat','💬'],['sos','🆘'],['account','◯']];
const mechanicTabs=[['sto','🔧'],['cars','🚙'],['notifications','🔔'],['account','◯']];
const isMechanic=()=>!isOwner()&&staffAssignments.some(a=>a.profile_id===me?.id&&a.staff_role==='mechanic');
const tabsForRole=()=>isOwner()?ownerTabs:isMechanic()?mechanicTabs:driverTabs;
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
 'approve-request','reject-request','cancel-request','cancel-days-off',
 'confirm-payment','reject-payment','post-repair','remove-part',
 'set-driver-access','delete-announcement',
 'claim-sos','release-sos','finish-sos','cancel-sos'
]);
function clearAccountState(){
 loadVersion++;forceMutationRefresh=0;clearPendingPassportPhotos();lastRecordsUserId=null;partialLoadWarningShown=false;photoUrlCache.clear();photoUrlInFlight.clear();staffAssignments=[];me=null;records=emptyRecords();selectedCar=null;selectedDriverId=null;carEditor=null;currentRepair=null;
 sessionInitialized=false;showMore=false;page='cars';lastAuthEmail='';pointWallets=[];pointHistory=[];pointLoaded=false;
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
function langControl(){return ''}
function navIcon(id){
 const paths={
 tracking:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3"/>',
 'nikcar-ai':'<path d="m12 2 2.3 7.7L22 12l-7.7 2.3L12 22l-2.3-7.7L2 12l7.7-2.3Z"/>',
 dashboard:'<rect x="3" y="3" width="7" height="7" rx="1.2"/><rect x="14" y="3" width="7" height="7" rx="1.2"/><rect x="3" y="14" width="7" height="7" rx="1.2"/><rect x="14" y="14" width="7" height="7" rx="1.2"/>',
 cars:'<path d="m5 17-1 3m15-3 1 3M5 17h14a2 2 0 0 0 2-2v-3l-2.5-6.5A2 2 0 0 0 16.6 4H7.4a2 2 0 0 0-1.9 1.5L3 12v3a2 2 0 0 0 2 2Z"/><path d="M3 12h18"/><path d="M7 14h.01M17 14h.01"/>',
 drivers:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
 requests:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3v2h6V3M9 10h6M9 14h6M9 18h4"/>',
 payments:'<rect x="2" y="5" width="20" height="15" rx="2"/><path d="M2 10h20M16 15h2"/>',
 sto:'<path d="M14 7l3-3 3 3-3 3M4 20l11-11M3 15l6 6"/>',repairs:'<path d="M14.7 6.3a5 5 0 0 0-6.4 6.4L3 17.6a2.4 2.4 0 1 0 3.4 3.4l5.3-5.3a5 5 0 0 0 6.4-6.4l-3.4 3.4-3.4-3.4z"/>',
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
function daysOffHistory(){return '<section class="card"><h3>Історія вихідних</h3>'+((records.driver_days_off||[]).map(o=>'<div class="line"><div>'+e(carName(o.vehicle_id))+' · '+e(o.date_from)+' — '+e(o.date_to)+' · '+e(o.status==='approved'?'Підтверджено':'Скасовано')+'</div>'+(isOwner()&&o.status==='approved'?'<button class="btn secondary tiny" data-action="cancel-days-off" data-id="'+e(o.id)+'">Скасувати</button>':'')+'</div>').join('')||'<p>Записів немає</p>')+'</section>'; }
function daysOffPage(){
  if(!isOwner())return '<div class="card">Оформлення вихідних доступне лише уповноваженим співробітникам.</div>';
  const cars=records.cars||[];
  const options=cars.map(car=>'<option value="'+e(car.id)+'">'+e(car.model)+' · '+e(car.plate)+'</option>').join('');
  const items=(records.driver_days_off||[]).slice().sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
  const rows=items.map(item=>{
   const active=item.status==='approved',dates=e(item.date_from)+' — '+e(item.date_to);
   const action=active?'<button type="button" class="btn secondary tiny" data-action="cancel-days-off" data-id="'+e(item.id)+'">Скасувати</button>':'';
   return '<div class="line"><div><b>'+e(carName(item.vehicle_id))+' · '+dates+'</b><div class="small">'+e(name(item.driver_id))+' · '+(active?'Підтверджено':'Скасовано')+'</div>'+(item.reason?'<div class="small">'+e(item.reason)+'</div>':'')+'</div>'+action+'</div>';
  }).join('');
  return '<section class="card"><h2>📅 Безоплатні вихідні водія</h2><p class="small">Обирайте період без обмеження кількості вихідних. Рішення зберігається на сервері; повторні періоди блокуються базою.</p><form id="days-off-form"><label>Автомобіль<select name="car" required>'+options+'</select></label><label>Початок<input name="from" type="date" required></label><label>Кінець<input name="to" type="date" required></label><label>Причина<input name="reason" maxlength="500" placeholder="Необов’язково"></label><button class="btn" type="submit">Підтвердити вихідні</button></form><p class="small">Вихідні враховано у розрахунку тижневої оренди в розділі платежів. Старі борги та проведені платежі збережено.</p></section><section class="card"><h2>Історія вихідних</h2>'+(rows||'<p class="small">Вихідних ще немає.</p>')+'</section>';
 }
function settingsPage(){
 if(!isOwner())return '<div class="card">Налаштування доступні власнику</div>';
 return '<section class="card"><h2>⚙ Налаштування NikCar</h2><p class="small">API та інтеграції, фінансові параметри, права доступу, оренда та сповіщення.</p><div class="row"><button class="btn secondary" data-action="nav" data-page="api">🔑 API та інтеграції</button><button class="btn secondary" data-action="nav" data-page="notifications">🔔 Сповіщення</button><button class="btn secondary" data-action="nav" data-page="account">👤 Обліковий запис</button></div><p class="small">Фінансові налаштування, ролі та безоплатні вихідні будуть активовані після перевірки серверних прав. Секретні API-ключі не вводьте в браузер.</p></section>';
}
function layout(body,title){
 const tabs=tabsForRole();
 const nav=tabs.map(([id,icon])=>`<button data-action="nav" data-page="${id}" class="${id===page?'active':''}" ${id===page?'aria-current="page"':''}><span class="nav-symbol">${navIcon(id)}</span> ${id==='sto'?'СТО':id==='tracking'?'GPS / Техніка':id==='nikcar-ai'?'ШІ NikCar':id==='api'?'API та інтеграції':t(id)}</button>`).join('');
 const visibleMobile=(isOwner()?['dashboard','cars','drivers','sto','points']:isMechanic()?['sto','cars','notifications','account']:['cars','announcements','requests','sto','sos']);
 const mobile=tabs.filter(([id])=>visibleMobile.includes(id)).map(([id,icon])=>`<button data-action="nav" data-page="${id}" class="${id===page?'active':''}" ${id===page?'aria-current="page"':''}><span>${navIcon(id)}</span><span>${id==='nikcar-ai'?'ШІ NikCar':t(id)}</span></button>`).join('')+`<button data-action="more" class="${showMore?'active':''}"><span>⋯</span><span>${lang==='uk'?'Ще':'More'}</span></button>`;
 const moreMenu=showMore?`<div class="more-overlay"><div class="more-sheet"><h2>${lang==='uk'?'Усі розділи':'All sections'}</h2>${tabs.filter(([id])=>!visibleMobile.includes(id)).map(([id,icon])=>`<button data-action="nav" data-page="${id}"><span>${navIcon(id)}</span>${id==='nikcar-ai'?'ШІ NikCar':t(id)}</button>`).join('')}<button class="btn secondary" data-action="more">${t('cancel')}</button></div></div>`:'';return `<div class="shell"><aside class="sidebar"><div class="brand"><img class="brand-mark" src="./icon.svg" alt="" width="42" height="42"><span class="brand-copy">Nik<em>Car</em><small>SERVICE · FLEET</small></span></div><div class="sidebar-kicker">${e(isOwner()?t('ownerGreeting'):t('driverProfile'))}</div><nav class="nav" aria-label="${lang==='uk'?'Основна навігація':'Main navigation'}">${nav}</nav><div class="sidehint">${t('onlyPilot')}</div></aside><div class="workspace"><header class="top"><div class="brand"><img class="brand-mark" src="./icon.svg" alt="" width="42" height="42"><span class="brand-copy">Nik<em>Car</em><small>SERVICE · FLEET</small></span></div><div class="right"><span class="small desktop-label">${e(me.full_name||user?.email||'')}</span>${status(me.access)} ${headerControls()}</div></header><main class="main"><div class="page-heading"><div><div class="subtitle">NIKCAR / FLEET CONTROL · 0.91.0</div><h1>${title}</h1></div><span class="page-context">${e(isOwner()?(lang==='uk'?'Кабінет власника':'Owner workspace'):(lang==='uk'?'Кабінет водія':'Driver workspace'))}</span></div>${body}</main></div><nav class="mobilebar" aria-label="${lang==='uk'?'Мобільна навігація':'Mobile navigation'}">${mobile}</nav>${moreMenu}</div>`;
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
 const tenantOpts=records.profiles.filter(isFleetDriverProfile).map(p=>'<option value="'+e(p.id)+'">'+e(p.full_name||p.phone||'Водій')+'</option>').join('');
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
  return `<div class="line" data-service-row data-car-id="${e(x.car_id)}" data-completed="${x.completed_at?'yes':'no'}" data-service-search="${e((x.title+' '+carName(x.car_id)+' '+x.kind+' '+(x.notes||'')).toLowerCase())}"><div><b>${e(x.title)}</b> · ${e(carName(x.car_id))}<div class="small">${e(x.kind)} · ${x.due_date?e(x.due_date):'Без дати'}${x.due_odometer_km!=null?' · ТО на '+e(x.due_odometer_km)+' км':''} · ${tag}</div>${x.notes?'<div class="small">'+e(x.notes)+'</div>':''}</div>${!x.completed_at?`<button class="btn secondary tiny" data-action="service-done" data-id="${e(x.id)}">Виконано</button>`:''}</div>`;
 }).join('');
 return `<section class="card"><h2>🛠 Контроль автопарку</h2><p class="small">ТО, страхування, сезонна заміна шин і техогляди. Попередження видно в панелі власника за 30 днів або за 1000 км до терміну. Push-повідомлення ще не підключені.</p>${records.cars.length?`<form id="service-event" class="form"><label class="field">Автомобіль<select name="car_id" required>${opts}</select></label><label class="field">Тип<select name="kind"><option value="maintenance">ТО</option><option value="insurance">Страхування</option><option value="tires">Сезонні шини</option><option value="inspection">Техогляд</option></select></label><label class="field">Назва<input name="title" required minlength="2" maxlength="160" placeholder="Наприклад, ОСЦПВ або заміна оливи"></label><div class="row stack"><label class="field">Дата<input type="date" name="due_date"></label><label class="field">Пробіг для ТО, км<input type="number" min="0" name="due_odometer_km"></label><label class="field">Поточний пробіг, км<input type="number" min="0" name="current_odometer_km"></label></div><label class="field">Примітки<input name="notes" maxlength="1000"></label><button class="btn" type="submit">Додати нагадування</button></form>`:'<p>Спочатку додайте автомобіль.</p>'}<h3>Календар подій</h3><div class="row stack"><label class="field">Пошук ТО<input id="service-search" placeholder="Авто, робота, примітки" autocomplete="off"></label><label class="field">Авто<select id="service-car-filter"><option value="">Усі автомобілі</option>${opts}</select></label><label class="field">Стан<select id="service-state-filter"><option value="">Усі</option><option value="no">Заплановані</option><option value="yes">Виконані</option></select></label></div><p class="small" id="service-filter-empty" hidden>За цими фільтрами записів немає.</p>${rows||'<p class="small">Подій поки немає.</p>'}</section>`;
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
 const files=(records.fleet_files||[]).slice().sort((a,b)=>Date.parse(b.created_at||0)-Date.parse(a.created_at||0)).map(x=>`<div class="line" data-fleet-file-row data-car-id="${e(x.car_id)}" data-kind="${e(x.kind)}" data-file-search="${e((x.title+' '+carName(x.car_id)+' '+(x.notes||'')).toLowerCase())}"><div><b>${e(x.title)}</b> · ${e(carName(x.car_id))}<div class="small">${e(x.kind)} · ${d(x.created_at)}</div></div><button type="button" class="btn secondary tiny" data-action="fleet-open-file" data-id="${e(x.id)}">Відкрити</button></div>`).join('');
 return `<section class="card"><h2>📷 Огляди та документи автопарку</h2><p class="small">Захищене зберігання договорів, актів та фотографій. Фото можна додати для подальшого порівняння. ІІ-порівняння фото доступне після налаштування серверного AI-ключа. Висновки потребують перевірки власником.</p>${records.cars.length?`
 <form id="fleet-inspection-form" class="form"><h3>Технічний огляд</h3><label class="field">Автомобіль<select name="car_id" required>${opts}</select></label><label class="field">Пробіг, км<input type="number" min="0" name="odometer_km"></label><div class="row stack"><label class="field">Двигун<select name="engine">${stateOptions}</select></label><label class="field">Гальма<select name="brakes">${stateOptions}</select></label><label class="field">Шини<select name="tires">${stateOptions}</select></label><label class="field">Кузов<select name="body">${stateOptions}</select></label></div><label class="field">Зауваження<textarea name="notes" maxlength="2000"></textarea></label><button class="btn" type="submit">Зберегти огляд</button></form>
 <form id="fleet-file-form" class="form"><h3>Документи автомобіля, страховка та фото</h3><p class="small">ОСЦПВ та КАСКО зберігаються як окремі типи документів. Дату завершення страхування внесіть у розділі ТО / страхування для нагадування.</p><label class="field">Автомобіль<select name="car_id" required>${opts}</select></label><label class="field">Тип<select name="kind"><option value="contract">Договір</option><option value="oscpv">ОСЦПВ (автоцивілка)</option><option value="casco">КАСКО</option><option value="registration">Техпаспорт</option><option value="service_invoice">Рахунок / акт СТО</option><option value="handover_act">Акт видачі</option><option value="return_act">Акт повернення</option><option value="damage_photo">Фото пошкодження</option><option value="inspection_photo">Фото огляду</option><option value="other">Інше</option></select></label><label class="field">Назва<input name="title" required minlength="2" maxlength="160"></label><label class="field">Файл (JPG, PNG, WebP або PDF до 15 МБ)<input name="file" type="file" required accept="image/jpeg,image/png,image/webp,application/pdf"></label><button class="btn" type="submit">Завантажити захищено</button></form>`:'<p>Спочатку додайте автомобіль.</p>'}
 <h3>ІІ-порівняння фото</h3><p class="small">Оберіть фото ДО і ПІСЛЯ одного авто. ІІ може помилятися через ракурс, світло чи забруднення. Аналіз запускається лише після натискання кнопки та за наявності серверного ключа.</p>${photoCount>=2?`<form id="fleet-damage-ai-form" class="form"><label class="field">Фото ДО<select name="before_file_id" required>${photoOptions}</select></label><label class="field">Фото ПІСЛЯ<select name="after_file_id" required>${photoOptions}</select></label><button class="btn" type="submit">Порівняти фотографії</button></form>`:'<p class="small">Спочатку завантажте два фото огляду.</p>'}<h3>Висновки ІІ</h3>${reviews||'<p class="small">Порівнянь ще немає.</p>'}<h3>Історія оглядів</h3>${inspections||'<p class="small">Оглядів ще немає.</p>'}<h3>Архів файлів</h3><div class="row stack"><label class="field">Пошук документа<input id="fleet-file-search" placeholder="Назва або автомобіль" autocomplete="off"></label><label class="field">Автомобіль<select id="fleet-file-car-filter"><option value="">Усі автомобілі</option>${opts}</select></label><label class="field">Тип<select id="fleet-file-kind-filter"><option value="">Усі типи</option><option value="contract">Договір</option><option value="oscpv">ОСЦПВ (автоцивілка)</option><option value="casco">КАСКО</option><option value="registration">Техпаспорт</option><option value="service_invoice">Рахунок / акт СТО</option><option value="handover_act">Акт видачі</option><option value="return_act">Акт повернення</option><option value="damage_photo">Фото пошкодження</option><option value="inspection_photo">Фото огляду</option><option value="other">Інше</option></select></label></div><p class="small" id="fleet-file-filter-empty" hidden>Документів за цими фільтрами немає.</p>${files||'<p class="small">Файлів ще немає.</p>'}</section>`;
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
let aiQuestion='',aiAnswer='',aiMemory=[],aiMemoryLoaded=false,aiSyncing=false,aiLastSync='';
async function refreshAiMemory(redraw=false){if(!sb||!user||!isOwner()||aiSyncing)return;aiSyncing=true;try{const {data,error}=await sb.from('nikcar_ai_memory').select('id,note,created_at').order('created_at',{ascending:false}).limit(60);if(error)throw error;aiMemory=data||[];aiMemoryLoaded=true;aiLastSync=new Date().toLocaleTimeString();if(redraw&&page==='nikcar-ai')render();}catch(err){console.warn('AI memory',err);if(redraw)toast(err.message);}finally{aiSyncing=false;}}

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
 if(!q)return 'Введіть запитання.';if(/правил|пам.?ят|запомн|памят|інструкц/.test(q))return aiMemory.length?'Збережені власником правила: '+aiMemory.map(x=>x.note).join('; '):'У памʼяті немає збережених правил. Додайте їх у блоці «Памʼять та актуалізація».';
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
function nikcarAiInsights(){
 const inspections=(records.fleet_inspections||[]).slice().sort((a,b)=>Date.parse(b.created_at||0)-Date.parse(a.created_at||0));
 const latest=new Map();for(const x of inspections)if(!latest.has(x.car_id))latest.set(x.car_id,x);
 const critical=[],attention=[];
 for(const [id,x] of latest){const bad=['engine','brakes','tires','body'].filter(k=>x[k]==='critical');const warn=['engine','brakes','tires','body'].filter(k=>x[k]==='attention');if(bad.length)critical.push({id,parts:bad});else if(warn.length)attention.push({id,parts:warn});}
 const undecided=(records.fleet_damage_reviews||[]).filter(x=>!x.owner_decision);
 const noInspection=(records.cars||[]).filter(c=>!latest.has(c.id));
 const rec=[];
 if(critical.length)rec.push('Перевірте критичні технічні зауваження перед наступною видачею авто.');
 if(attention.length)rec.push('Заплануйте огляд автомобілів із зауваженнями до технічного стану.');
 if(undecided.length)rec.push('Перегляньте AI-порівняння фото й зафіксуйте рішення власника.');
 if(noInspection.length)rec.push('Додайте первинні технічні огляди для авто без історії перевірок.');
 if(aiExpenseAnomalies().length)rec.push('Звірте незвичні витрати з рахунками та виконаними роботами.');
 return {critical,attention,undecided,noInspection,rec};
}
function nikcarAiPage(){
 if(!isOwner())return '<div class="banner warning">Доступ лише власнику.</div>';
 const pending=records.rental_requests.filter(x=>x.status==='pending').length;
 const unpaid=records.payment_claims.filter(x=>x.status==='declared').length;
 const alerts=[{label:pending?pending+' заявок очікують рішення':'Немає нових заявок',page:'requests',urgent:!!pending},{label:unpaid?unpaid+' платежів потребують перевірки':'Немає неперевірених платежів',page:'payments',urgent:!!unpaid}];
 const financial=aiFinancialRows().sort((a,b)=>b.balance-a.balance);
 const anomalies=aiExpenseAnomalies();
 const insights=nikcarAiInsights();const memoryList=aiMemory.slice(0,12).map(x=>'<div class="line"><div><b>'+e(x.note)+'</b><div class="small">'+d(x.created_at)+'</div></div><button class="btn secondary tiny" data-action="ai-forget" data-id="'+e(x.id)+'">Видалити</button></div>').join('');
 const reviews=records.fleet_damage_reviews.slice().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,4).map(x=>'<div class="line"><div><b>'+e(carName(x.car_id))+'</b><div class="small">'+e(x.result?.summary||'Попередній висновок')+'</div><div class="small">'+(x.result?.comparable===false?'Фото не можна надійно порівняти · ':'')+'Рішення: '+e(x.owner_decision||'очікує власника')+' · '+e(x.result?.recommendation||'Перевірте фото вручну')+'</div></div></div>').join('');
 return '<div class="ai-hub"><section class="card"><h2>✦ NikCar AI</h2><p class="small">Помічник власника · читання даних без права змінювати записи. Аналітика оновлюється з даних автопарку. Памʼять правил зберігається окремо; це не перенавчання мовної моделі.</p><div class="ai-quick"><button class="btn secondary tiny" data-action="ai-ask" data-question="Скільки автомобілів вільно?">Автопарк</button><button class="btn secondary tiny" data-action="ai-ask" data-question="Які фінанси та витрати?">Фінанси</button><button class="btn secondary tiny" data-action="ai-ask" data-question="Які заявки в оренду?">Оренда</button><button class="btn secondary tiny" data-action="ai-ask" data-question="Які фотоогляди?">Фотоогляди</button></div><div class="ai-answer" role="status">'+e(aiAnswer||'Оберіть тему або напишіть запитання про автопарк.')+'</div><form id="nikcar-ai-question" class="chat-compose"><input name="question" maxlength="500" required placeholder="Запитайте про автомобілі, витрати, оренду…" value="'+e(aiQuestion)+'"><button class="btn" type="submit">➤</button></form></section><section class="card"><h3>🧠 Памʼять та актуалізація</h3><p class="small">Дані автопарку актуалізуються під час синхронізації. Правила додає лише власник. Оновлено: '+e(aiLastSync||'ще не синхронізовано')+'</p><button class="btn secondary tiny" data-action="ai-sync">Оновити знання</button><form id="nikcar-ai-memory-form" class="chat-compose"><input name="note" required minlength="3" maxlength="1000" placeholder="Правило або зауваження для агента"><button class="btn" type="submit">Запамʼятати</button></form>'+(memoryList||'<p class="small">Правил поки немає.</p>')+'</section><section class="card"><h3>⚠️ Попередження</h3>'+alerts.map(x=>'<button type="button" class="ai-alert-row" data-action="nav" data-page="'+x.page+'"><span>'+e(x.label)+'</span><span>'+ (x.urgent?'Перевірити':'Переглянути') +' ›</span></button>').join('')+'<p class="small">Зміни платежів, оренди та списання не виконуються автоматично.</p></section><section class="card"><h3>🛠 Технічні ризики та рекомендації</h3><p class="small">За останнім записаним оглядом кожного авто. Не замінює діагностику механіка.</p>'+(insights.critical.length?insights.critical.map(x=>'<div class="line"><strong>Критично · '+e(carName(x.id))+'</strong><span>'+e(x.parts.join(', '))+'</span></div>').join(''):'')+(insights.attention.length?insights.attention.map(x=>'<div class="line">Увага · '+e(carName(x.id))+' · '+e(x.parts.join(', '))+'</div>').join(''):'')+'<div class="small">Без техогляду: '+insights.noInspection.length+' · AI-висновків без рішення: '+insights.undecided.length+'</div>'+(insights.rec.length?insights.rec.map(x=>'<div class="line">• '+e(x)+'</div>').join(''):'<p class="small">Нових рекомендацій за наявними записами немає.</p>')+'<button class="btn secondary" data-action="nav" data-page="documents">Огляди та фото</button></section><section class="card"><h3>📷 Результати фотооглядів</h3>'+(reviews||'<p class="small">Поки немає висновків.</p>')+'<button class="btn secondary" data-action="nav" data-page="documents">Перейти до фотооглядів</button></section><section class="card"><h3>📊 Автомобілі · 30 днів</h3><p class="small">Підтверджені платежі мінус внесені витрати. Не чистий прибуток: зарплата, податки та інші витрати можуть бути неповними.</p>'+ (financial.length?financial.map(x=>'<div class="ai-finance-row"><b>'+e(carName(x.car.id))+'</b><span>Надходження '+money(x.income)+'</span><span>Витрати '+money(x.expense)+'</span><strong>Різниця '+money(x.balance)+'</strong></div>').join(''):'<p class="small">Автомобілів ще немає.</p>')+'</section><section class="card"><h3>🔎 Незвичні витрати</h3><p class="small">Позначає суми понад 3× медіани при щонайменше 4 записах тієї самої категорії для одного авто за 30 днів. Це сигнал для перевірки, не доказ помилки.</p>'+(anomalies.length?anomalies.map(x=>'<div class="line">'+e(carName(x.car_id))+' · '+e(x.category)+' · '+money(x.amount)+'</div>').join(''):'<p class="small">Підозрілих відхилень за цим правилом немає або даних недостатньо.</p>')+'</section></div>';
}
function isFleetDriverProfile(p){return p?.role==='driver'&&!staffAssignments.some(a=>a.profile_id===p.id&&['administrator','accountant','mechanic'].includes(a.staff_role));}
function isServiceStaffProfile(p){return p?.role==='driver'&&staffAssignments.some(a=>a.profile_id===p.id&&['administrator','accountant','mechanic'].includes(a.staff_role));}
function dashboardPage(){if(!isOwner())return `<div class="banner warning">${t('notApproved')}</div>`;
 const total=records.cars.length, drivers=records.profiles.filter(isFleetDriverProfile);
 const pending=records.rental_requests.filter(x=>x.status==='pending');
 const urgent=records.sos_requests.filter(x=>['open','claimed'].includes(x.status));
 const nums=[[t('countCars'),total,navIcon('cars')],[t('countDrivers'),drivers.length,navIcon('drivers')],[t('countPending'),pending.length,navIcon('requests')],[t('countSOS'),urgent.length,navIcon('sos')]];
 const cards=nums.map(([label,val,icon])=>`<div class="metric"><span class="metric-icon">${icon}</span><div class="metric-value">${val}</div><div class="small">${label}</div></div>`).join('');
 const requestRows=pending.slice(0,5).map(r=>`<div class="line"><div><b>${e(carName(r.car_id))}</b><div class="small">${e(name(r.driver_id))} · ${d(r.created_at)}</div></div><button class="btn secondary tiny" data-action="nav" data-page="requests">${t('requests')}</button></div>`).join('');
 const sosRows=urgent.slice(0,5).map(x=>`<div class="line"><div><b>${e(t(x.category))}</b><div class="small">${e(name(x.requester_id))} · ${e(x.location_text||'')}</div></div>${status(x.status)}</div>`).join('');
 const hi=lang==='uk'?'Вітаємо в NikCar':'Welcome to NikCar';
 const summary=lang==='uk'?'Управляйте автопарком, перевіряйте заявки та платежі в одному місці.':'Manage your fleet, requests and payments in one workspace.';
 const fleetFree=records.cars.filter(c=>c.status==='free').length;
 const fleetOther=Math.max(0,total-fleetFree);
 const pct=total?Math.round(fleetFree/total*100):0;
 const allRequests=records.rental_requests.length;
 const pendingPct=allRequests?Math.round(pending.length/allRequests*100):0;
 const visual='<div class="insights-grid"><section class="card insight-card"><div><div class="insight-eyebrow">FLEET STATUS</div><h3>Стан автопарку</h3><p class="small">На основі актуальних записів автомобілів</p><div class="chart-legend"><span><i class="legend-dot lime"></i>Вільні: <b>'+fleetFree+'</b></span><span><i class="legend-dot muted"></i>Інші: <b>'+fleetOther+'</b></span></div></div><div class="donut-chart" role="img" aria-label="Вільні автомобілі: '+fleetFree+' з '+total+'" style="--chart-value:'+pct+'%"><div><strong>'+pct+'%</strong><small>вільні</small></div></div></section><section class="card insight-card"><div><div class="insight-eyebrow">REQUESTS</div><h3>Заявки на оренду</h3><p class="small">Очікують розгляду: <strong>'+pending.length+'</strong> із '+allRequests+'</p><div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+pendingPct+'" aria-label="Частка заявок в очікуванні"><span style="width:'+pendingPct+'%"></span></div><p class="small">'+pendingPct+'% заявок очікують рішення</p></div><button class="btn secondary tiny" data-action="nav" data-page="requests">Переглянути заявки</button></section></div>';
 const shortcuts='<div class="dashboard-shortcuts"><button class="quick-action" data-action="nav" data-page="cars"><span class="quick-icon">'+navIcon('cars')+'</span><span><strong>'+(lang==='uk'?'Автомобілі':'Vehicles')+'</strong><small>'+(lang==='uk'?'Переглянути автопарк':'View fleet')+'</small></span><span class="quick-arrow">↗</span></button><button class="quick-action" data-action="nav" data-page="requests"><span class="quick-icon">'+navIcon('requests')+'</span><span><strong>'+(lang==='uk'?'Заявки':'Requests')+'</strong><small>'+pending.length+' '+(lang==='uk'?'очікують':'pending')+'</small></span><span class="quick-arrow">↗</span></button><button class="quick-action" data-action="nav" data-page="points"><span class="quick-icon">'+navIcon('points')+'</span><span><strong>Fuel Points</strong><small>'+(lang==='uk'?'Баланси та заправки':'Wallets and fuel')+'</small></span><span class="quick-arrow">↗</span></button><button class="quick-action" data-action="nav" data-page="payments"><span class="quick-icon">'+navIcon('payments')+'</span><span><strong>'+(lang==='uk'?'Платежі':'Payments')+'</strong><small>'+(lang==='uk'?'Контроль надходжень':'Review transfers')+'</small></span><span class="quick-arrow">↗</span></button></div>';return `<div class="dashboard-hero"><div><span class="hero-overline">NIKCAR · FLEET CONTROL</span><h2>${hi}</h2><p>${summary}</p></div><img src="./fleet-hero.svg" width="280" height="190" alt="${lang==='uk'?'Векторна ілюстрація NikCar':'NikCar vector illustration'}"></div><div class="metric-grid">${cards}</div>${shortcuts}<div id="nikcar-debt-chart"><div class="card">Завантаження заборгованості…</div></div>${visual}${fleetOverviewVisuals()}${fleetIntelligencePage()}${fleetServicePage()}${fleetEvidencePage()}<div class="notice-line"><span class="notice-dot"></span><b>${lang==='uk'?'Fuel Points — активний облік':'Fuel Points — wallet available'}</b><span class="small">${lang==='uk'?'Баланс, поповнення та ручний облік заправок доступні. Дистанційне керування АЗС буде підключено пізніше.':'Wallet, top-ups and manual fuel records are available. Remote pump control will be connected later.'}</span><button class="btn secondary tiny" data-action="nav" data-page="points">${lang==='uk'?'Відкрити баланс':'Open wallet'}</button></div><div class="two-panel"><div class="card"><div class="panel-heading"><h2>${t('countPending')}</h2><button class="btn secondary tiny" data-action="nav" data-page="requests">${t('reload')}</button></div>${requestRows||`<p>${t('noRequests')}</p>`}</div><div class="card"><h2>${t('sos')}</h2>${sosRows||`<p>${t('noSos')}</p>`}</div></div><div class="two-panel"><div class="card"><h2>${t('newsFeed')}</h2>${records.announcements.slice(0,2).map(a=>`<div class="line"><div><b>${e(a['title_'+lang])}</b><div class="small">${e(a['body_'+lang]).slice(0,165)}</div></div></div>`).join('')||t('emptyNews')}<button class="btn secondary tiny" data-action="nav" data-page="announcements">${t('announcements')}</button></div><div class="card"><h2>${t('releaseSoon')}</h2><p>${t('summaryInfo')}</p><div class="tag warn">${t('onlyPilot')}</div></div></div>`;
}
let staffAssignments=[];
async function refreshStaffAssignments(){if(!me)return false;const {data,error}=await sb.from('nikcar_staff_assignments').select('*');if(error)throw error;const next=data||[];const before=JSON.stringify(staffAssignments);staffAssignments=next;return before!==JSON.stringify(next);}
function staffAssignmentsPanel(){if(!isOwner())return '';const staff=records.profiles.filter(p=>p.role==='driver').sort((a,b)=>String(a.full_name||'').localeCompare(String(b.full_name||''),'uk'));return '<details class="card" style="margin-bottom:16px"><summary style="cursor:pointer;font-weight:700;padding:8px 0">👥 Адміністратори, бухгалтери та СТОшники</summary><div style="padding-top:12px"><p class="small">Призначення посади доступне власнику. СТОшник має доступ до заявок СТО, фотографій та зміни статусу ремонту.</p>'+staff.map(p=>{const current=staffAssignments.find(a=>a.profile_id===p.id)?.staff_role||'';return '<div class="row stack" style="margin:10px 0;align-items:center"><span style="flex:1">'+e(p.full_name||p.phone||'Користувач')+'</span><select data-staff-profile="'+e(p.id)+'" aria-label="Посада '+e(p.full_name||'')+'"><option value="" '+(!current?'selected':'')+'>Без посади</option><option value="administrator" '+(current==='administrator'?'selected':'')+'>Адміністратор</option><option value="accountant" '+(current==='accountant'?'selected':'')+'>Бухгалтер</option><option value="mechanic" '+(current==='mechanic'?'selected':'')+'>СТОшник · механік</option></select><button type="button" class="btn secondary tiny" data-action="save-staff-role" data-id="'+e(p.id)+'">Зберегти</button></div>'}).join('')+'</div></details>'; }
function filterDriverCards(){
 const needle=(document.getElementById('driver-filter')?.value||'').toLowerCase().trim();
 const group=document.querySelector('[data-action="driver-tab"][aria-pressed="true"]')?.dataset.id||'active';
 let visible=0;
 document.querySelectorAll('#driver-list .driver-card').forEach(el=>{
  const show=el.dataset.driverGroup===group&&(el.dataset.search||'').includes(needle);
  el.hidden=!show;if(show)visible++;
 });
 const empty=document.getElementById('driver-empty');if(empty)empty.hidden=visible>0;
}
function driversPage(){if(!isOwner())return `<div class="banner warning">${t('notApproved')}</div>`;
 const staffPanel=staffAssignmentsPanel();const people=records.profiles.filter(isFleetDriverProfile).slice().sort((a,b)=>String(a.full_name||'').localeCompare(String(b.full_name||''),'uk'));const staffPeople=records.profiles.filter(isServiceStaffProfile).slice().sort((a,b)=>String(a.full_name||'').localeCompare(String(b.full_name||''),'uk'));
 const list=people.map(p=>{
 const docs=records.driver_documents.filter(doc=>doc.driver_id===p.id);
 const open=records.rental_requests.filter(r=>r.driver_id===p.id&&['pending','approved'].includes(r.status)).length;
 const search=e(((p.full_name||'')+' '+(p.phone||'')).toLowerCase());
 return `<div class="driver-card" data-driver-group="${p.access==='archived'?'archive':'active'}" ${p.access==='archived'?'hidden':''} data-search="${search}"><div class="driver-identity">${p.avatar_path?privatePhoto(p.avatar_path,'driver-avatar',p.full_name,'./icon.svg'):'<span class="driver-avatar driver-initial">' + e((p.full_name||'?').trim().charAt(0).toUpperCase()) + '</span>'}<div><div class="driver-name">${e(p.full_name||'—')} ${status(p.access)}</div><div class="small">${e(p.phone||t('phone'))}</div><div class="small">${docs.length}/5+ ${t('documents')} · ${open} ${t('requests')}</div></div></div><div class="driver-actions"><select aria-label="${t('access')}" data-driver-id="${e(p.id)}" class="driver-status-select">${['candidate','active','archived','blocked'].map(v=>`<option value="${v}" ${p.access===v?'selected':''}>${t(v)}</option>`).join('')}</select><button class="btn secondary tiny" data-action="set-driver-access" data-id="${e(p.id)}">${t('applyAccess')}</button><button class="btn secondary tiny" data-action="driver-docs" data-id="${e(p.id)}">${t('documents')}</button></div></div>`;
 }).join('');
 const archivedCount=people.filter(p=>p.access==='archived').length;
 const activeCount=people.length-archivedCount;
 return `${staffPanel}<details class="card"><summary style="cursor:pointer;font-weight:700">🛠️ Обслуговуючий персонал (${staffPeople.length})</summary><div style="padding-top:12px">${staffPeople.map(p=>{const role=staffAssignments.find(a=>a.profile_id===p.id)?.staff_role;return '<div class="line"><b>'+e(p.full_name||'—')+'</b><span class="small">'+e(({administrator:'Адміністратор',accountant:'Бухгалтер',mechanic:'Механік / СТО'})[role]||role)+'</span></div>'}).join('')||'<p class="small">Немає призначеного персоналу</p>'}</div></details><details class="card" id="driver-days-off"><summary style="cursor:pointer;font-weight:700;padding:8px 0">📅 Безоплатні вихідні водіїв — керування</summary><div style="padding-top:14px">${daysOffPage()}</div></details><div class="banner">${t('driverStatusHint')}</div><div class="card"><div class="actions"><button type="button" class="btn tiny" data-action="driver-tab" data-id="active" aria-pressed="true">Активні (${activeCount})</button><button type="button" class="btn secondary tiny" data-action="driver-tab" data-id="archive" aria-pressed="false">📦 Архів (${archivedCount})</button></div><label class="field">${t('driverSearch')}<input id="driver-filter" autocomplete="off" placeholder="${t('driverSearch')}"></label><div id="driver-list">${list||`<p>${t('noDrivers')}</p>`}</div><p class="small" id="driver-empty" hidden>Немає водіїв у цій вкладці</p></div>`;
}
function announcementsPage(){const articles=records.announcements.map(a=>`<article class="card news-card"><div class="card-top"><span class="small">${a.pinned?'📌 · ':''}${d(a.created_at)}</span>${isOwner()?`<button class="btn secondary tiny" data-action="delete-announcement" data-id="${e(a.id)}">${t('removeNews')}</button>`:''}</div><h2>${e(a['title_'+lang])}</h2><p class="notice-copy">${e(a['body_'+lang])}</p>${isOwner()?`<button class="btn secondary tiny" data-action="copy-announcement" data-id="${e(a.id)}">${t('copyText')}</button>`:''}</article>`).join('');
 const compose=isOwner()?`<div class="card"><h2>${t('addNews')}</h2><form id="announcement-form" class="form"><div class="row stack"><label class="field" style="flex:1">${t('newsTitleUa')}<input name="title_uk" required maxlength="120"></label><label class="field" style="flex:1">${t('newsTitleEn')}<input name="title_en" required maxlength="120"></label></div><div class="row stack"><label class="field" style="flex:1">${t('newsBodyUa')}<textarea name="body_uk" required maxlength="2200"></textarea></label><label class="field" style="flex:1">${t('newsBodyEn')}<textarea name="body_en" required maxlength="2200"></textarea></label></div><label class="row" style="justify-content:flex-start"><input name="pinned" type="checkbox">${t('pin')}</label><button class="btn" type="submit">${t('addNews')}</button></form></div>`:'';
 return `<div class="notice-line"><span class="notice-dot"></span><b>${lang==='uk'?'Fuel Points — активний облік':'Fuel Points — wallet available'}</b><span class="small">${lang==='uk'?'Баланс, поповнення та ручний облік заправок доступні. Дистанційне керування АЗС буде підключено пізніше.':'Wallet, top-ups and manual fuel records are available. Remote pump control will be connected later.'}</span><button class="btn secondary tiny" data-action="nav" data-page="points">${lang==='uk'?'Відкрити баланс':'Open wallet'}</button></div><div class="news-grid">${compose}<section class="news-list">${articles||`<div class="card">${t('emptyNews')}</div>`}</section></div>`;
}

function trackingPage(){
 if(!isOwner())return '<div class="banner warning">Доступ лише власнику.</div>';
 const categories={car:'Легковий автомобіль',van:'Бус',truck:'Вантажівка',trailer:'Причіп',motorcycle:'Мотоцикл',equipment:'Спецтехніка',generator:'Генератор',other:'Інша техніка'};
 const cars=records.cars.map(c=>'<option value="'+e(c.id)+'">'+e(c.model+' · '+c.plate)+'</option>').join('');
 const list=records.fleet_tracking_assets.map(x=>'<article class="tracking-asset"><div><b>'+e(x.title)+'</b><div class="small">'+e(categories[x.category]||'Техніка')+(x.car_id?' · '+e(carName(x.car_id)):'')+'</div><div class="small">Провайдер: '+e(x.provider||'Не підключений')+' · GPS: немає сигналу</div>'+'<div class="small">IMEI: '+e(x.device_identifier||'Не вказано')+' · SIM: '+e(x.sim_phone||'Не вказано')+'</div>'+(x.note?'<div class="small">'+e(x.note)+'</div>':'')+'<form id="tracking-rename-'+e(x.id)+'" class="tracking-rename-form"><input name="title" aria-label="Назва трекера" maxlength="120" minlength="2" required value="'+e(x.title)+'"><button type="button" class="btn secondary tiny" data-action="rename-tracking-asset" data-id="'+e(x.id)+'">Змінити назву</button></form></div><button type="button" class="btn secondary tiny" data-action="delete-tracking-asset" data-id="'+e(x.id)+'">Видалити</button></article>').join('');
 return '<div class="tracking-page">'+(window.NikCarGpsDemo?window.NikCarGpsDemo.render():'')+'<section class="card"><h2>⌖ GPS / Техніка</h2><p class="small">Реєстр автомобілів та обладнання. Реальний GPS-моніторинг почне працювати лише після підключення трекера або телематичного API. Поки координати й маршрути не отримуються.</p><div class="banner warning">GPS-пристрої не підключені. Не показуємо вигадане місцезнаходження.</div></section><section class="card"><h3>Моя техніка · '+records.fleet_tracking_assets.length+'</h3>'+(list||'<p class="small">Додайте перший пристрій або одиницю техніки.</p>')+'</section><section class="card"><h3>Додати техніку / трекер</h3><form id="tracking-asset-form" class="form-grid"><label class="field">Назва в додатку<input name="title" maxlength="120" required placeholder="Наприклад: Один"></label><label class="field">Тип<select name="category">'+Object.entries(categories).map(([k,v])=>'<option value="'+k+'">'+v+'</option>').join('')+'</select></label><label class="field">Автомобіль (необов’язково)<select name="car_id"><option value="">Не прив’язувати</option>'+cars+'</select></label><label class="field">Платформа / виробник<input name="provider" maxlength="100" placeholder="Teltonika FMB920 · Traccar / Wialon"></label><label class="field">IMEI трекера<input name="device_identifier" inputmode="numeric" pattern="[0-9]{15}" maxlength="15" minlength="15" required placeholder="15 цифр IMEI"></label><label class="field">Номер SIM-картки трекера<input name="sim_phone" type="tel" pattern="\\+?[0-9]{9,15}" required placeholder="+380XXXXXXXXX"></label><label class="field">Примітка<input name="note" maxlength="500" placeholder="Де встановлений трекер"></label><button class="btn" type="submit">Додати до реєстру</button></form></section></div>';
}
let vehicleCheckOpen=null;
let vehicleCheckAudit={};
async function loadVehicleCheckAudit(carId){const {data,error}=await sb.from('vehicle_registry_checks').select('*').eq('car_id',carId).order('checked_at',{ascending:false}).limit(12);if(error)throw error;vehicleCheckAudit[carId]=data||[];}
function vehicleCheckPanel(car){
 const insurance=(records.fleet_service_events||[]).filter(x=>x.car_id===car.id&&x.kind==='insurance').sort((a,b)=>String(b.due_date||'').localeCompare(String(a.due_date||'')))[0];
 const fines=(records.fleet_fines||[]).filter(x=>x.car_id===car.id).sort((a,b)=>Date.parse(b.created_at||0)-Date.parse(a.created_at||0));
 const date=insurance?.due_date;const history=vehicleCheckAudit[car.id]||[];const last=history[0];
 const insuranceState=!date?'Не підтверджено':date<new Date().toISOString().slice(0,10)?'Дата закінчення минула':'Дата закінчення внесена вручну';
 return '<section class="vehicle-check-panel"><h3>📄 Реєстрація</h3><p class="small">Техпаспорт: '+e(isOwner()?car.registration_certificate||'не внесено':'приховано')+' · VIN: '+e(car.vin||'не внесено')+'</p>'+(isOwner()&&(car.registration_photo_path||car.registration_photo_back_path)?'<div style="margin:10px 0"><b>Фото техпаспорта</b><div>'+(car.registration_photo_path?privatePhoto(car.registration_photo_path,'car-photo','Лицьова сторона техпаспорта','./icon.svg'):'')+(car.registration_photo_back_path?privatePhoto(car.registration_photo_back_path,'car-photo','Зворотна сторона техпаспорта','./icon.svg'):'')+'</div></div>':'')+(isOwner()?'<button class="btn secondary tiny" data-action="registry-check" data-id="'+e(car.id)+'">🔎 Перевірити дані авто</button>':'')+'<p class="small">Останній запит: '+e(last?d(last.checked_at)+' · '+(last.status==='verified'?'Підтверджено':'API не підключено'):'ще не виконано')+'</p><h3>🛡️ Страхування</h3><p><b>'+e(insuranceState)+'</b></p><p class="small">Остання внесена дата: '+e(date||'немає')+'. Це внутрішні дані NikCar, не перевірка реєстру МТСБУ.</p><h3>⚖️ Штрафи</h3><p><b>Зареєстровано в NikCar: '+fines.length+'</b></p>'+(fines.length?fines.slice(0,8).map(f=>'<div class="line"><span>'+e(f.notice_number||'Постанова')+' · '+e(f.violation_at||'')+'</span><strong>'+money(f.amount)+'</strong></div>').join(''):'<p class="small">У NikCar штрафи не внесені. Це не підтверджує їх відсутність у МВС.</p>')+'<p class="small">Дані для запиту автоматично беруться з картки авто. Онлайн-синхронізація з державними реєстрами ще не підключена. Для автоматичної перевірки потрібен дозволений API-провайдер.</p><div class="actions"><a class="btn secondary tiny" href="https://mtsbu.ua/avtocivilka/perevirka-chinnosti-polisu" target="_blank" rel="noopener noreferrer">Звірити з МТСБУ</a><a class="btn secondary tiny" href="https://bdr.mvs.gov.ua/" target="_blank" rel="noopener noreferrer">Звірити з МВС</a></div></section>';
}
function importExistingRentalPanel(){
 if(!isOwner())return '';
 const free=records.cars.filter(c=>c.status==='free'&&!records.rental_requests.some(r=>r.car_id===c.id&&['pending','approved'].includes(r.status)));
 const drivers=records.profiles.filter(p=>isFleetDriverProfile(p)&&p.access==='active'&&!records.rental_requests.some(r=>r.driver_id===p.id&&['pending','approved'].includes(r.status)));
 return '<div class="card" style="margin-top:16px"><h2>🚘 Перенести діючу оренду</h2><p class="small">Спочатку додайте авто як звичайне. Потім виберіть авто й водія тут. Нові нарахування почнуться з моменту перенесення в NikCar. Старі місяці не перераховуються. Попередній борг вноситься окремо і не дублюється.</p>'+(!free.length||!drivers.length?'<p class="small">Для перенесення потрібні вільний автомобіль та активний водій без іншої відкритої оренди.</p>':'<form class="form" id="import-existing-rental"><label class="field">Автомобіль<select name="car" required>'+free.map(c=>'<option value="'+e(c.id)+'">'+e(c.model+' · '+c.plate)+'</option>').join('')+'</select></label><label class="field">Водій<select name="driver" required>'+drivers.map(p=>'<option value="'+e(p.id)+'">'+e(p.full_name||p.phone||'Водій')+'</option>').join('')+'</select></label><label class="field">Пробіг на момент перенесення, км<input name="odometer" type="number" min="0" max="3000000" step="1" required></label><label class="field">Старий непогашений борг, грн<input name="opening_debt" type="number" min="0" max="10000000" step="0.01" value="0" required></label><p class="small">Дата початку обліку: сьогодні, за часом Києва. Попередня дата видачі не створює нарахувань. Власник підтверджує правильність початкового боргу.</p><button class="btn" type="submit">Перенести діючу оренду</button></form>')+'</div>';
}
function carsPage(){const owner=isOwner();const list=records.cars.map(c=>`<div class="card"><div class="car-top"><div class="car-icon">${navIcon('cars')}</div>${status(c.status)}</div><div class="car-art">${privatePhoto(c.photo_path,'vehicle-photo',c.model+' '+c.plate,'./fleet-hero.svg')}</div><h2 style="margin-top:8px">${e(c.model)}</h2><div class="vehicle-details"><div><span>Марка</span><b>${e(String(c.model||"").trim().split(/\s+/)[0]||"—")}</b></div><div><span>Модель</span><b>${e(String(c.model||"").trim().split(/\s+/).slice(1).join(" ")||"—")}</b></div><div><span>Держномер</span><b>${e(c.plate||"—")}</b></div><div><span>Рік випуску</span><b>${e(c.year||"Не вказано")}</b></div><div class="vehicle-vin"><span>VIN-код</span><b>${e(c.vin||"Не вказано")}</b></div><div><span>Техпаспорт</span><b>${owner?e(c.registration_certificate||"Не вказано"):"Приховано"}</b></div></div><div class="rate">${money(c.weekly_rate??Number(c.daily_rate)*7)} <span class="small">/ тиждень</span></div><div class="car-checks"><button type="button" class="btn secondary tiny" data-action="vehicle-check" data-id="${e(c.id)}">🛡️ Страховка та штрафи <span aria-hidden="true">⌄</span></button><span class="small">Переглянути відомості без переходу на інший сайт</span></div>${vehicleCheckOpen===c.id?vehicleCheckPanel(c):''}${owner?`<div class="actions" style="flex-wrap:wrap"><label class="btn secondary tiny" style="cursor:pointer">📷 Змінити фото<input type="file" accept="image/jpeg,image/png,image/webp" data-car-avatar="${e(c.id)}" style="display:none"></label><button class="btn secondary tiny" data-action="edit-car" data-id="${e(c.id)}">${t('carEdit')}</button><button class="btn secondary tiny" data-action="delete-car" data-id="${e(c.id)}" style="border-color:#b94a4a;color:#ff8f8f">${lang==='uk'?'Видалити':'Delete'}</button></div>`:''}${canApply()&&c.status==='free'?`<button class="btn full" data-action="choose-car" data-id="${e(c.id)}">${t('apply')}</button>`:''}</div>`).join('');const add=owner?`<div class="card" style="margin-top:19px"><h2>${t('newCar')}</h2><div class="card" style="padding:14px;margin:12px 0"><label class="field">📄 Техпаспорт — лицьова сторона<input id="tech-passport-photo" type="file" accept="image/jpeg,image/png,image/webp"></label><label class="field">📄 Техпаспорт — зворотна сторона<input id="tech-passport-back-photo" type="file" accept="image/jpeg,image/png,image/webp"></label><p class="small" id="tech-passport-attachments">Фото ще не вибрані. Обидві сторони зберігаються після додавання авто.</p><p class="small" id="tech-passport-status" role="status">Розпізнавання на пристрої. Перевірте дані перед збереженням.</p><p class="small" id="tech-passport-vin" aria-live="polite"></p></div><form class="form" id="new-car"><label class="field">📷 Фото автомобіля (JPG, PNG, WebP, до 5 МБ)<input name="car_photo" type="file" accept="image/jpeg,image/png,image/webp"></label><div class="row stack"><label class="field" style="flex:1">${t('model')}<input name="model" required minlength="2" maxlength="120"></label><label class="field" style="flex:1">${t('plate')}<input name="plate" required maxlength="20"></label></div><label class="field">Серія та номер техпаспорта<input name="registration_certificate" maxlength="32" autocomplete="off"></label><label class="field">VIN (довільний текст)<input name="vin" maxlength="100" autocapitalize="characters" autocorrect="off" spellcheck="false" placeholder="VF14SRCL463809882"></label><div class="row stack"><label class="field" style="flex:1">${t('year')}<input name="year" type="number" min="1900" max="2100" required></label><label class="field" style="flex:1">${t('rate')}<input name="rate" type="number" step="0.01" min="1" required></label></div><div class="actions"><button class="btn" type="submit">${t('saveCar')}</button><button class="btn secondary" type="button" data-action="clear-new-car">${lang==='uk'?'Очистити поля':'Clear fields'}</button></div></form></div>`:'';const edit=owner&&carEditor?(()=>{const c=records.cars.find(v=>v.id===carEditor);return c?`<div class="card" style="margin-top:16px"><h2>${t('carEdit')} · ${e(c.plate)}</h2><form id="edit-car-form" class="form"><label class="field">📷 Замінити фото автомобіля<input name="car_photo" type="file" accept="image/jpeg,image/png,image/webp"></label><input type="hidden" name="car_id" value="${e(c.id)}"><div class="row stack"><label class="field" style="flex:1">${t('model')}<input name="model" value="${e(c.model)}" required maxlength="120"></label><label class="field" style="flex:1">${t('plate')}<input name="plate" value="${e(c.plate)}" required maxlength="20"></label></div><label class="field">Серія та номер техпаспорта<input name="registration_certificate" maxlength="32" autocomplete="off" value="${e(c.registration_certificate||'')}"></label><label class="field">VIN (довільний текст)<input name="vin" maxlength="100" autocapitalize="characters" value="${e(c.vin||'')}"></label><div class="row stack"><label class="field" style="flex:1">${t('year')}<input name="year" type="number" min="1900" max="2100" required value="${e(c.year||'')}"></label><label class="field" style="flex:1">Оренда, грн / тиждень<input name="rate" type="number" step="0.01" min="1" value="${Number(c.weekly_rate??Number(c.daily_rate)*7)}" required></label></div><p class="small">Нова ціна діє з наступного дня за київським часом. Попередні дні залишаються за старою ціною.</p><div class="actions"><button type="submit" class="btn">${t('saveChanges')}</button><button type="button" class="btn secondary" data-action="cancel-car-edit">${t('cancelEdit')}</button></div></form></div>`:'';})():'';return `<p>${owner?t('summaryInfo'):t('registerInfo')}</p><div class="cards">${list||`<div class="empty-state"><img src="./fleet-hero.svg" loading="lazy" alt=""><div><h3>${t('noCars')}</h3><p>${lang==='uk'?'Додайте перший автомобіль, щоб почати роботу з автопарком.':'Add your first vehicle to start managing the fleet.'}</p></div></div>`}</div>${edit}${add}${importExistingRentalPanel()}`}
function docFor(kind,driver,car=null){return records.driver_documents.find(d=>d.kind===kind&&d.driver_id===driver&&(kind.startsWith('rental_contract')?d.car_id===car:d.car_id===null));}
function docRequiredTypes(){return ['passport_1','passport_2','passport_3','tax_id','rental_contract','rental_contract_2','rental_contract_3'];}
function hasLocalDocs(car){return docRequiredTypes().every(kind=>!!docFor(kind,me.id,kind.startsWith('rental_contract')?car:null));}
function uploadItem(kind,driver,car=null){const doc=docFor(kind,driver,car);const val=kind.startsWith('rental_contract')&&!car?`<div class="small">${t('selectFirst')}</div>`:'';
 const own=me?.id===driver;const label=kind.startsWith('rental_contract')?'Договір оренди · фото '+(kind==='rental_contract'?'1':kind.slice(-1))+' із 3':t(kind);
 return `<div class="line"><div style="min-width:0"><b>${e(label)}</b><div class="small">${doc?`${t('docsDone')} · ${d(doc.created_at)}`:t('docsWaiting')}</div>${val}</div><div class="actions">${doc?`<button type="button" class="btn secondary tiny" data-action="open-doc" data-id="${e(doc.id)}">${t('openDocument')}</button>`:''}${own?`<button type="button" class="btn secondary tiny" data-action="choose-doc-photo" data-input-id="doc-gallery-${kind}" >🖼️ З галереї</button><input id="doc-gallery-${kind}" type="file" accept="image/jpeg,image/png,image/webp" style="display:none" data-doc-kind="${kind}" data-car="${car||''}"><button type="button" class="btn secondary tiny" data-action="choose-doc-photo" data-input-id="doc-camera-${kind}" >📷 Камера</button><input id="doc-camera-${kind}" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" style="display:none" data-doc-kind="${kind}" data-car="${car||''}">`:''}</div></div>`;}

/* NikCar contracts: local-only owner details; do not publish personal IDs in source. */
function nikcarContractSettings(){try{return JSON.parse(localStorage.getItem('nikcar-contract-owner-v1')||'{}')}catch{return {}}}
function nikcarContractToday(){const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');}
function nikcarContractPanel(){
 const o=nikcarContractSettings();
 const opts=records.cars.map(c=>'<option value="'+e(c.id)+'">'+e(c.model)+' · '+e(c.plate)+'</option>').join('');
 return '<div class="card"><h2>📄 Договір оренди</h2><p class="small">Виберіть автомобіль, заповніть реквізити орендодавця один раз і роздрукуйте договір. Оберіть орендаря: ім’я та телефон підставляться з профілю. Дані з фото паспорта можна розпізнати та перевірити перед друком.</p><form id="nikcar-contract-owner" class="form"><label class="field">ПІБ орендодавця<input name="owner_name" required value="'+e(o.name||'')+'"></label><label class="field">РНОКПП<input name="owner_tax" inputmode="numeric" maxlength="10" value="'+e(o.tax||'')+'"></label><label class="field">Документ, що посвідчує особу<input name="owner_doc" value="'+e(o.doc||'')+'"></label><label class="field">Адреса реєстрації<input name="owner_address" value="'+e(o.address||'')+'"></label><label class="field">Телефон<input name="owner_phone" value="'+e(o.phone||'')+'"></label><button class="btn secondary" type="submit">Зберегти реквізити на цьому пристрої</button></form><div class="form" style="margin-top:14px"><label class="field">Дата договору (за замовчуванням сьогодні; можна змінити)<input id="nikcar-contract-date" type="date" value="'+nikcarContractToday()+'"></label><label class="field">Вартість автомобіля, грн<input id="nikcar-contract-value" type="number" min="0" step="1" value="400000"></label><label class="field">Початок оренди<input id="nikcar-rent-start" type="date"></label><label class="field">Закінчення оренди<input id="nikcar-rent-end" type="date"></label><label class="field">Орендар<select id="nikcar-contract-tenant"><option value="">Оберіть водія</option>'+tenantOpts+'</select></label><button class="btn secondary" type="button" data-action="contract-tenant-fill">Заповнити дані орендаря</button><button class="btn secondary" type="button" data-action="contract-tenant-ocr">Розпізнати завантажені документи</button><p id="contract-ocr-status" class="small" aria-live="polite">Перевірте розпізнані дані за оригіналами документів.</p><label class="field">ПІБ орендаря<input id="contract-tenant-name" autocomplete="off"></label><label class="field">РНОКПП орендаря<input id="contract-tenant-tax" inputmode="numeric" maxlength="10"></label><label class="field">Паспорт орендаря<input id="contract-tenant-passport"></label><label class="field">Адреса орендаря<input id="contract-tenant-address"></label><label class="field">Телефон орендаря<input id="contract-tenant-phone"></label><label class="field">Автомобіль<select id="nikcar-contract-car"><option value="">Оберіть автомобіль</option>'+opts+'</select></label><p class="small">Увага: шаблон договору фізичних осіб потребує нотаріального посвідчення відповідно до ст. 799 ЦК України. Перевірте всі умови перед підписанням.</p><div class="actions"><button class="btn secondary" type="button" data-action="sign-rental-contract" data-id="owner">✍ Підпис орендодавця</button><span class="small" id="nikcar-sign-owner-status">Не підписано</span><button class="btn secondary" type="button" data-action="sign-rental-contract" data-id="tenant">✍ Підпис орендаря</button><span class="small" id="nikcar-sign-tenant-status">Не підписано</span></div><p class="small">Підпис зберігається тільки для поточного документа. Намальований підпис не є кваліфікованим електронним підписом (КЕП).</p><button class="btn" type="button" data-action="print-rental-contract">Переглянути та друкувати договір</button></div></div>';
}
function nikcarFillTenant(){
 const p=records.profiles.find(p=>p.id===document.getElementById('nikcar-contract-tenant')?.value);
 if(!p){toast('Оберіть орендаря');return;}
 const name=document.getElementById('contract-tenant-name'),phone=document.getElementById('contract-tenant-phone');
 if(name)name.value=p.full_name||'';
 if(phone)phone.value=p.phone||'';
}
async function nikcarOcrTenant(){
 if(!isOwner())return;
 const id=document.getElementById('nikcar-contract-tenant')?.value;
 if(!id){toast('Оберіть орендаря');return;}
 nikcarFillTenant();
 const status=document.getElementById('contract-ocr-status');
 const docs=records.driver_documents.filter(d=>d.driver_id===id&&['passport_1','passport_2','passport_3','tax_id'].includes(d.kind));
 if(!docs.length){if(status)status.textContent='Документи орендаря не завантажені. Заповніть реквізити вручну.';return;}
 let worker=null;
 try{
  if(status)status.textContent='Розпізнавання документів…';
  if(!window.Tesseract)await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';s.onload=resolve;s.onerror=reject;document.head.appendChild(s);});
  worker=await window.Tesseract.createWorker('ukr+eng',1);
  let texts=[];
  for(const doc of docs){
   const signed=await sb.storage.from('nikcar-driver-docs').createSignedUrl(doc.object_path,120);
   if(signed.error)throw signed.error;
   const response=await fetch(signed.data.signedUrl);
   if(!response.ok)throw Error('Не вдалося завантажити фото документа');
   const blob=await response.blob();
   const result=await worker.recognize(blob);
   texts.push({kind:doc.kind,text:result.data.text||''});
  }
  const taxText=texts.find(t=>t.kind==='tax_id')?.text||'';
  const taxCandidates=taxText.match(/\b\d{10}\b/g)||[];
  const tax=document.getElementById('contract-tenant-tax');
  if(tax&&taxCandidates.length===1&&!tax.value.trim())tax.value=taxCandidates[0];
  const passportText=texts.filter(t=>t.kind.startsWith('passport')).map(t=>t.text).join(' ');
  const passportCandidates=[...passportText.matchAll(/(?:серія|паспорт|passport)\s*[:№#]?\s*([А-ЯІЇЄҐA-Z]{2}\s*\d{6}|\d{9})/giu)].map(m=>m[1].replace(/\s/g,''));
  const passport=document.getElementById('contract-tenant-passport');
  if(passport&&passportCandidates.length===1&&!passport.value.trim())passport.value=passportCandidates[0];
  if(status)status.textContent='Розпізнавання завершено. ПІБ і телефон — з профілю; РНОКПП і паспорт — лише за однозначного збігу. Адресу перевірте та внесіть вручну. Обов’язково звірте всі поля з фото.';
 }catch(err){if(status)status.textContent='Не вдалося розпізнати фото: '+(err.message||String(err))+'. Можна заповнити вручну.';}
 finally{if(worker)try{await worker.terminate();}catch(_){}}
}
// Signatures are held only in memory until this document is printed; never reuse them for another agreement.
const nikcarContractSignatures={owner:null,tenant:null};
function nikcarOpenSignature(role){
 if(!isOwner()||!['owner','tenant'].includes(role))return;
 document.getElementById('nikcar-signature-overlay')?.remove();
 const overlay=document.createElement('div');
 overlay.id='nikcar-signature-overlay';
 overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px';
 const panel=document.createElement('div');
 panel.style.cssText='background:white;color:#111;border-radius:14px;width:min(100%,620px);padding:18px;box-sizing:border-box';
 const title=document.createElement('h3');title.textContent=role==='owner'?'Підпис орендодавця':'Підпис орендаря';
 const info=document.createElement('p');info.textContent='Підпишіться пальцем або стилусом. Підпис буде вставлено тільки в поточний договір. Перевірте документ перед підписанням.';
 const canvas=document.createElement('canvas');
 canvas.width=900;canvas.height=320;canvas.style.cssText='display:block;width:100%;height:180px;background:#fff;border:2px solid #aaa;border-radius:8px;touch-action:none';
 const controls=document.createElement('div');controls.style.cssText='display:flex;flex-wrap:wrap;gap:8px;margin-top:12px';
 const make=(label,handler)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.style.cssText='padding:10px 16px;border-radius:8px;border:1px solid #aaa;cursor:pointer';b.addEventListener('click',handler);controls.appendChild(b);};
 const ctx=canvas.getContext('2d');ctx.strokeStyle='#142c52';ctx.lineWidth=3.6;ctx.lineCap='round';ctx.lineJoin='round';
 let drawing=false,hasInk=false;
 const point=ev=>{const r=canvas.getBoundingClientRect();return {x:(ev.clientX-r.left)*canvas.width/r.width,y:(ev.clientY-r.top)*canvas.height/r.height};};
 canvas.addEventListener('pointerdown',ev=>{ev.preventDefault();canvas.setPointerCapture(ev.pointerId);drawing=true;hasInk=true;const p=point(ev);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x+.1,p.y+.1);ctx.stroke();});
 canvas.addEventListener('pointermove',ev=>{if(!drawing)return;ev.preventDefault();const p=point(ev);ctx.lineTo(p.x,p.y);ctx.stroke();});
 const stop=()=>{drawing=false;};
 canvas.addEventListener('pointerup',stop);canvas.addEventListener('pointercancel',stop);
 make('Очистити',()=>{ctx.clearRect(0,0,canvas.width,canvas.height);hasInk=false;});
 make('Скасувати',()=>overlay.remove());
 make('Зберегти підпис',()=>{
  if(!hasInk){toast('Спочатку поставте підпис');return;}
  nikcarContractSignatures[role]=canvas.toDataURL('image/png');
  overlay.remove();
  const label=document.getElementById('nikcar-sign-'+role+'-status');
  if(label)label.textContent='Підпис додано до поточного договору';
 });
 panel.append(title,info,canvas,controls);overlay.appendChild(panel);document.body.appendChild(overlay);
}
function nikcarPrintRentalContract(){
 if(!isOwner())return;
 const o=nikcarContractSettings(),car=records.cars.find(c=>c.id===document.getElementById('nikcar-contract-car')?.value);
 if(!car){toast('Спочатку виберіть автомобіль');return}
 if(!o.name||!o.tax){toast('Збережіть ПІБ і РНОКПП орендодавця');return}
 const dateValue=document.getElementById('nikcar-contract-date')?.value||nikcarContractToday();
 const dateMatch=/^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
 if(!dateMatch||!Number.isFinite(Date.parse(dateValue))||new Date(dateValue+'T12:00:00').getDate()!==Number(dateMatch[3])){toast('Оберіть коректну дату договору');return;}
 const contractDate='«'+dateMatch[3]+'» '+['січня','лютого','березня','квітня','травня','червня','липня','серпня','вересня','жовтня','листопада','грудня'][Number(dateMatch[2])-1]+' '+dateMatch[1]+' р.';
 const x=v=>e(String(v??'—'));
 const owner=x(o.name),model=x(car.model),plate=x(car.plate),vin=x(car.vin),year=x(car.year),color=x(car.color),registration=x(car.registration_certificate),rate=x(car.weekly_rate??Number(car.daily_rate)*7);
 const blank='________________________________________';
 const tenantField=id=>document.getElementById('contract-tenant-'+id)?.value?.trim()||blank;
 const tenantName=x(tenantField('name')),tenantTax=x(tenantField('tax')),tenantPassport=x(tenantField('passport')),tenantAddress=x(tenantField('address')),tenantPhone=x(tenantField('phone'));
 const rawValue=document.getElementById('nikcar-contract-value')?.value;
 const vehicleValue=Number(rawValue);
 if(rawValue===''||!Number.isFinite(vehicleValue)||vehicleValue<0){toast('Вкажіть коректну вартість автомобіля');return;}
 const formatDate=v=>{if(!v)return blank;const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(v);if(!match||!Number.isFinite(Date.parse(v))||new Date(v+'T12:00:00').getDate()!==Number(match[3]))return null;return '«'+match[3]+'» '+['січня','лютого','березня','квітня','травня','червня','липня','серпня','вересня','жовтня','грудня'][Number(match[2])-1]+' '+match[1]+' р.';};
 const rentStartValue=document.getElementById('nikcar-rent-start')?.value||'';
 const rentEndValue=document.getElementById('nikcar-rent-end')?.value||'';
 const rentStart=formatDate(rentStartValue),rentEnd=formatDate(rentEndValue);
 if(!rentStart||!rentEnd||(rentStartValue&&rentEndValue&&rentEndValue<rentStartValue)){toast('Перевірте дати початку та завершення оренди');return;}
 const vehicleValueText=vehicleValue.toLocaleString('uk-UA');
 const lines=[
 ['1. Предмет договору','1.1. Орендодавець передає Орендарю у строкове платне користування автомобіль '+model+', '+year+' року випуску, VIN '+vin+', державний номер '+plate+', колір '+color+', свідоцтво про реєстрацію '+registration+'.','1.2. Узгоджена вартість автомобіля: '+vehicleValueText+' грн.'],
 ['2. Умови договору','2.1. Автомобіль передається за актом приймання-передачі з фіксацією пробігу, пального, комплектності та пошкоджень.','2.2. Після завершення оренди Орендар повертає автомобіль за актом з урахуванням нормального зносу.','2.3. Орендар оплачує звичайні експлуатаційні витрати та шкоду, завдану з його вини. Планове ТО організовує Орендодавець.','2.4. Заборонено передавати автомобіль третім особам без письмової згоди Орендодавця, керувати у стані сп’яніння, самовільно змінювати конструкцію.','2.5. Дозволено законне використання автомобіля для таксі за умови дотримання вимог законодавства, страхування та необхідних дозволів.','2.6. Орендар відповідає за власні порушення ПДР, повідомляє про ДТП і несправності та відшкодовує документально підтверджені збитки, завдані з його вини.','2.7. Автомобіль передається з повним баком та повертається з повним баком того самого пального. Недостача відшкодовується за фактичними підтвердженими витратами.','2.8. Автомобіль повертається чистим, із ключами, документами та комплектністю, зазначеними в акті.'],
 ['3. Порядок розрахунків','3.1. Орендна плата становить '+rate+' грн за добу. Оплата здійснюється щопонеділка до 12:00 за попередній розрахунковий період, якщо сторони письмово не погодили інше.','3.2. Погоджені безоплатні дні зменшують лише нарахування за відповідний період і не погашають попередню заборгованість.'],
 ['4. Строк договору','4.1. Строк оренди: з '+rentStart+' до '+rentEnd+'. Продовження оформлюється письмово.'],
 ['5. Відповідальність сторін','5.1. Відшкодовуються документально підтверджені збитки з урахуванням нормального зносу та чинного законодавства.'],
 ['6. Інші умови','6.1. Договір може бути змінено або припинено за згодою сторін.','6.2. У неврегульованих питаннях сторони керуються законодавством України.','6.3. Договір укладається у двох примірниках і підлягає нотаріальному посвідченню у випадках, передбачених законом.','6.4. Інші погоджені умови: '+blank+'.']
 ];
 const section=lines.map(a=>'<h3>'+a[0]+'</h3>'+a.slice(1).map(t=>'<p>'+t+'</p>').join('')).join('');
 const signatureImage=role=>nikcarContractSignatures[role]?'<img alt="Підпис" style="display:block;max-width:190px;height:70px;object-fit:contain" src="'+nikcarContractSignatures[role]+'">':'______________';
 const html='<!doctype html><html lang="uk"><head><meta charset="utf-8"><title>NikCar · Договір оренди</title><style>@page{size:A4;margin:17mm}body{font:12pt/1.42 "Times New Roman",serif;color:#111}h1,h2{text-align:center}h1{font-size:17pt}h2{font-size:14pt}h3{font-size:13pt;margin:15px 0 6px}p{margin:6px 0;text-align:justify}.sign{display:flex;justify-content:space-between;gap:30px;margin-top:28px}.sign>div{width:49%}.note{font-size:10pt}@media screen{body{max-width:780px;margin:30px auto;padding:25px;box-shadow:0 0 8px #ccc}}</style></head><body><h1>ДОГОВІР<br>оренди транспортного засобу</h1><p>м. Миколаїв &nbsp;&nbsp;&nbsp; '+contractDate+'</p><p>'+owner+', документ: '+x(o.doc||blank)+', РНОКПП '+x(o.tax)+', адреса: '+x(o.address||blank)+' (надалі — «ОРЕНДОДАВЕЦЬ»), та '+tenantName+' (надалі — «ОРЕНДАР») уклали цей договір:</p>'+section+'<h3>7. Реквізити та підписи</h3><div class="sign"><div><b>ОРЕНДОДАВЕЦЬ</b><p>'+owner+'</p><p>РНОКПП: '+x(o.tax)+'</p><p>Телефон: '+x(o.phone||blank)+'</p><p>Підпис: '+signatureImage('owner')+'</p></div><div><b>ОРЕНДАР</b><p>ПІБ: '+tenantName+'</p><p>РНОКПП: '+tenantTax+'</p><p>Паспорт: '+tenantPassport+'</p><p>Адреса: '+tenantAddress+'</p><p>Телефон: '+tenantPhone+'</p><p>Підпис: '+signatureImage('tenant')+'</p></div></div><p class="note">NikCar · Друкована форма для перевірки сторонами та нотаріусом. Ця скорочена друкована редакція не замінює повний погоджений Word-шаблон.</p></body></html>';
 const w=window.open('','_blank');
 if(!w){toast('Дозвольте спливаючі вікна для перегляду договору');return}
 w.document.open();w.document.write(html);w.document.close();w.focus();
}

function documentsPage(){if(isOwner()){
 const selectedDriver=selectedDriverId&&records.profiles.some(p=>p.id===selectedDriverId&&p.role==='driver')?selectedDriverId:null;
 const profiles=records.profiles.filter(p=>p.role==='driver'&&(!selectedDriver||p.id===selectedDriver));
 const lines=profiles.map(p=>{const docs=records.driver_documents.filter(d=>d.driver_id===p.id);return `<div class="card"><h2>${e(p.full_name||'—')}</h2><div class="small">${e(p.phone||'')} · ${e(p.access||'')}</div>${docs.length?docs.map(d=>`<div class="line"><div>${e(d.kind.startsWith('rental_contract')?'Договір · фото '+(d.kind==='rental_contract'?'1':d.kind.slice(-1)):t(d.kind))}${d.car_id?` <span class="small">· ${e(carName(d.car_id))}</span>`:''}</div><button class="btn secondary tiny" data-action="open-doc" data-id="${e(d.id)}">${t('openDocument')}</button></div>`).join(''):`<p>${t('docsWaiting')}</p>`}</div>`;}).join('');return nikcarContractPanel()+`<div class="banner warning">${t('docOwnerNote')}${selectedDriver?` · ${e(name(selectedDriver))}`:''}</div>${selectedDriver?`<button class="btn secondary tiny" data-action="all-driver-docs" style="margin-bottom:12px">${lang==='uk'?'Показати всіх водіїв':'Show all drivers'}</button>`:''}<div class="cards">${lines||`<div class="card">${t('empty')}</div>`}</div>`;
 }
 if(!me||me.role!=='driver')return '';
 const car=records.cars.find(c=>c.id===selectedCar);
 const available=records.cars.filter(c=>c.status==='free'||records.rental_requests.some(r=>r.car_id===c.id&&r.driver_id===me.id&&r.handed_over_at&&!r.returned_at));
 if(!selectedCar&&available.length===1)selectedCar=available[0].id;
 const carOptions=available.map(c=>`<option value="${e(c.id)}" ${selectedCar===c.id?'selected':''}>${e(c.model)} · ${e(c.plate)}</option>`).join('');
 const ready=!!car&&hasLocalDocs(car.id);
 return `<div class="banner warning">${t('docsInfo')}</div><div class="banner">🔐 ${t('docsPrivacy')}</div><div class="card"><h2>${t('selectedCar')}</h2><label class="field">${t('chooseCar')}<select id="document-car"><option value="">${t('selectFirst')}</option>${carOptions}</select></label><div class="small" style="margin-top:9px">${car?`${e(car.model)} · ${e(car.plate)} · ${money(car.weekly_rate??Number(car.daily_rate)*7)} / тиждень`:''}</div></div><div class="card"><h2>${t('docsTitle')}</h2>${docRequiredTypes().map(kind=>uploadItem(kind,me.id,kind.startsWith('rental_contract')?selectedCar:null)).join('')}<p class="note" style="margin-top:15px">${t('docLimit')}</p></div><div class="card"><button class="btn full" data-action="submit-doc-choice" ${ready?'':'disabled'}>${t('submitCar')}</button><p>${ready?t('docsDone'):t('docsMissing')}</p></div>`;
}
function requestsPage(){
 const rows=records.rental_requests.map(r=>{
  const isActive=r.status==='approved'&&!!r.handed_over_at&&!r.returned_at;
  const rentalDetails=r.handed_over_at?`<div class="small">${lang==='uk'?'Видано':'Handed over'}: ${d(r.handed_over_at)} · ${lang==='uk'?'Пробіг':'Odometer'} ${e(r.odometer_out_km)} км · ${lang==='uk'?'Повний бак':'Full tank'} ✓</div>`:'';
  const returnDetails=r.returned_at?`<div class="small">${lang==='uk'?'Повернуто':'Returned'}: ${d(r.returned_at)} · ${e(r.odometer_in_km)} км · ${lang==='uk'?'Повний бак':'Full tank'} ✓</div>`:'';
  const damageItems=records.rental_damage_photos.filter(x=>x.rental_request_id===r.id);const canAddDamage=r.status==='approved'&&!r.returned_at&&(isOwner()||r.driver_id===me.id);const damageHtml=(canAddDamage||damageItems.length)?'<div class="rental-damage"><div class="rental-damage-title">📸 Фото пошкоджень крупним планом <span class="small">('+damageItems.length+')</span></div><div class="damage-gallery">'+damageItems.map(x=>'<button type="button" class="damage-photo-card" data-action="view-damage" data-id="'+e(x.id)+'">'+privatePhoto(x.photo_path,'damage-thumbnail',x.description||'Фото пошкодження','./icon.svg')+'<span>'+e(x.description||'Фото пошкодження')+'</span></button>').join('')+'</div>'+(canAddDamage?'<form class="damage-upload-form" data-rental="'+e(r.id)+'"><label class="field">Крупний план дефекту (до 5 МБ)<input type="file" name="damage_photo" accept="image/jpeg,image/png,image/webp" capture="environment" required></label><label class="field">Що саме пошкоджено?<input name="damage_description" placeholder="Наприклад: подряпина заднього бампера" maxlength="200" required></label><button class="btn secondary tiny" type="submit">Додати фото дефекту</button></form>':'')+'</div>':'';const ownerButtons=isOwner()&&r.status==='approved'?(isActive?`<button class="btn tiny" data-action="return-rental" data-id="${e(r.id)}">${lang==='uk'?'Прийняти повернення':'Accept return'}</button>`:`<button class="btn tiny" data-action="handover-rental" data-id="${e(r.id)}">${lang==='uk'?'Видати авто':'Hand over car'}</button>`):'';const handoverForm=isOwner()&&r.status==='approved'?`<form class="rental-odometer-form" data-request="${e(r.id)}" data-mode="${isActive?'return':'handover'}" style="display:none;width:100%;margin-top:12px;padding:12px;border:1px solid #59612d;border-radius:12px"><label class="field">${isActive?'Пробіг при поверненні, км':'Пробіг при видачі, км'}<input name="odometer" type="number" inputmode="numeric" min="${isActive?Number(r.odometer_out_km)||0:0}" max="3000000" step="1" required placeholder="Введіть пробіг"></label><label class="field">Примітка (необов'язково)<input name="note" maxlength="2000" placeholder="Стан автомобіля"></label><label style="display:flex;gap:8px;align-items:center;margin:10px 0"><input type="checkbox" name="full_tank" required> Підтверджую повний бак та передачу авто і ключів</label><button class="btn" type="submit">${isActive?'Підтвердити повернення':'Підтвердити видачу'}</button><button class="btn secondary" type="button" data-action="cancel-odometer-form">Скасувати</button></form>`:'';
  return `<div class="line"><div><b>${e(carName(r.car_id))}</b><div class="small">${e(name(r.driver_id))} · ${d(r.created_at)}</div><div style="margin-top:5px">${status(r.status)} ${isActive?'<span class="tag">🚗 '+(lang==='uk'?'В оренді':'On rent')+'</span>':''}</div>${rentalDetails}${returnDetails}${damageHtml}</div><div class="actions">${isOwner()&&r.status==='pending'?`<button class="btn tiny" data-action="approve-request" data-id="${r.id}">${t('approve')}</button><button class="btn secondary tiny" data-action="reject-request" data-id="${r.id}">${t('reject')}</button>`:''}${r.driver_id===me.id&&r.status==='pending'?`<button class="btn secondary tiny" data-action="cancel-request" data-id="${r.id}">${t('cancel')}</button>`:''}${ownerButtons}${handoverForm}</div></div>`;
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
 return `<section class="card chat-panel"><div class="chat-header"><div class="chat-avatar">💬</div><div><b>Чат NikCar</b><div><button type="button" class="btn secondary tiny" data-action="enable-push">🔔 Увімкнути push</button></div><div class="small"><span id="chat-online-count">${chatOnlineUsers.size} онлайн</span> · спільний чат автопарку</div></div></div><div class="chat-people" aria-label="Учасники чату">${people||'<span class="small">Учасників поки немає</span>'}</div><div class="chatbox" id="messages" role="log" aria-label="Повідомлення">${lines||`<span class="small">${t('noChat')}</span>`}</div><form id="chat-send" class="chat-compose"><input name="text" aria-label="${t('message')}" placeholder="Написати повідомлення…" autocomplete="off" maxlength="2000" required><button class="btn" type="submit" aria-label="${t('send')}">➤</button></form></section>`;
}
function sosPage(){if(!activeMember())return `<div class="banner warning">${t('notApproved')}</div>`;const form=!isOwner()?`<div class="card" style="margin-bottom:15px"><form id="sos-create" class="form"><label class="field">${t('sosType')}<select name="category">${['jump_start','tow','wheel','other'].map(v=>`<option value="${v}">${t(v)}</option>`).join('')}</select></label><label class="field">${t('location')}<input name="location" maxlength="200"></label><label class="field">${t('description')}<textarea name="note" maxlength="1000"></textarea></label><button class="btn" type="submit">${t('createSos')}</button></form></div>`:'';const list=records.sos_requests.map(s=>{const claim=s.status==='open'&&s.requester_id!==me.id&&!isOwner();const release=s.status==='claimed'&&s.helper_id===me.id;const cancel=s.status==='open'&&s.requester_id===me.id;return `<div class="line"><div><b>${e(t(s.category))}</b><div class="small">${e(name(s.requester_id))} · ${d(s.created_at)}</div><p>${e(s.location_text||'')} ${e(s.note||'')}</p>${status(s.status)} ${s.helper_id?`<span class="small">${t('helper')}: ${e(name(s.helper_id))}</span>`:''}</div><div class="actions">${claim?`<button class="btn tiny" data-action="claim-sos" data-id="${s.id}">${t('claim')}</button>`:''}${release?`<button class="btn secondary tiny" data-action="release-sos" data-id="${s.id}">${t('release')}</button><button class="btn tiny" data-action="finish-sos" data-id="${s.id}">${t('complete')}</button>`:''}${cancel?`<button class="btn secondary tiny" data-action="cancel-sos" data-id="${s.id}">${t('cancelSos')}</button>`:''}</div></div>`}).join('');return `<p>${t('sosInfo')}</p>${form}<div class="card">${list||t('noSos')}</div>`}
function finesSection(){
 const all=(records.fleet_fines||[]).filter(x=>isOwner()||x.driver_id===me?.id);
 const owed=all.filter(x=>x.status==='assigned').reduce((sum,x)=>sum+Number(x.amount||0),0);
 const rows=all.slice().sort((a,b)=>String(b.violation_at).localeCompare(String(a.violation_at))).map(x=>'<div class="line"><div><b>'+e(carName(x.car_id))+' · '+money(x.amount)+'</b><div class="small">Постанова: '+e(x.notice_number)+' · '+d(x.violation_at)+'</div><div class="small">'+e(x.status==='assigned'?'Закріплено за водієм':x.status==='pending_review'?'Потрібна перевірка':x.status==='paid'?'Сплачено':'Скасовано')+(isOwner()&&x.driver_id?' · '+e(name(x.driver_id)):'')+'</div></div>'+(isOwner()&&x.status==='assigned'?'<button type="button" class="btn secondary tiny" data-action="cancel-fine" data-id="'+e(x.id)+'">Скасувати помилкове</button>':'')+'</div>').join('');
 const carOptions=(records.cars||[]).map(c=>'<option value="'+e(c.id)+'">'+e(c.model)+' · '+e(c.plate)+'</option>').join('');
 const ownerForm=isOwner()?'<form class="form" id="fleet-fine-form"><h3>Додати підтверджену постанову</h3><p class="small">Водій визначається автоматично за часом видачі та повернення. Якщо збіг неоднозначний, штраф залишається на перевірці.</p><label class="field">Автомобіль<select name="car_id" required>'+carOptions+'</select></label><label class="field">Номер постанови<input name="notice_number" required maxlength="100"></label><label class="field">Дата і час порушення<input name="violation_at" type="datetime-local" required></label><label class="field">Сума, ₴<input name="amount" type="number" step="0.01" min="0.01" required></label><label class="field">Примітка<input name="notes" maxlength="500"></label><button class="btn" type="submit">Зареєструвати штраф</button></form>':'';
 return '<section class="card"><h2>⚖️ Штрафи ПДР</h2><p class="small">Штрафи закріплюються за водієм автоматично за часом фактичної оренди. Підтвердження водія не потрібне. Дані з офіційного реєстру поки не синхронізуються автоматично.</p><h3>Нараховано до сплати: '+money(owed)+'</h3>'+rows+(rows?'':'<p class="small">Штрафів немає.</p>')+ownerForm+'</section>';
}
function fuelPriceSection(){
 const price=records.fleet_fuel_price?.[0]?.price_uah;
 const priceText=price?money(price):'Не встановлена';
 const history=isOwner()?(records.fleet_fuel_price_history||[]).slice(0,8).map(h=>'<div class="small">'+d(h.changed_at)+' · '+(h.old_price_uah?money(h.old_price_uah):'—')+' → '+money(h.new_price_uah)+'</div>').join(''):'';
 const form=isOwner()?'<form class="form" id="fuel-price-form"><label class="field">Нова ціна дизеля, ₴/літр<input name="price" type="number" min="0.01" max="1000" step="0.01" required value="'+e(price||'')+'"></label><p class="small">Баланс Points зберігається у гривневому еквіваленті. Після зміни ціни доступні літри перераховуються. Історія виконаних заправок не змінюється.</p><button class="btn" type="submit">Попередній перегляд ціни</button></form>':'';
 return '<section class="card"><div class="point-balance-hero"><div class="point-title"><img src="./icon.svg" alt="NikCar"> Point Balance</div><div class="point-total">1 Point = 1 ₴</div><div class="point-details">Доступні літри перераховуються за поточною ціною</div></div><h2>⛽ Тариф дизеля</h2><div class="line"><b>1 Point = 1 гривня</b><b>'+priceText+' / л</b></div>'+form+(history?'<h3>Історія зміни тарифу</h3>'+history:'')+'</section>';
}
const notificationDefaults={ai:true,fines:true,fuel:true,payments:true,daysOff:true,quiet:true,service:true,sound:true,vibrate:true};
function notificationKey(){return 'nikcar-notify-v1-'+(user?.id||'guest');}
function notificationState(){try{const x=JSON.parse(localStorage.getItem(notificationKey())||'{}');return {settings:{...notificationDefaults,...x.settings},read:Array.isArray(x.read)?x.read:[],seen:Array.isArray(x.seen)?x.seen:[]};}catch{return {settings:{...notificationDefaults},read:[],seen:[]};}}
function saveNotificationState(x){try{localStorage.setItem(notificationKey(),JSON.stringify({...x,read:x.read.slice(-300),seen:x.seen.slice(-300)}));}catch{}}
function smartEvents(){
 if(!me)return [];
 const out=[],add=(id,category,title,body,page,time,priority='normal')=>out.push({id,category,title,body,page,time:time||'',priority});
 const mine=x=>isOwner()||x.driver_id===me.id;
 for(const f of records.fleet_fines||[]){if(!mine(f)||f.status!=='assigned')continue;add('fine-'+f.id,'fines','⚖️ Штраф '+money(f.amount),carName(f.car_id)+' · постанова '+f.notice_number,'payments',f.created_at,'important');}
 for(const p of records.payment_claims||[]){if(!mine(p))continue;if(isOwner()&&p.status==='declared')add('payment-'+p.id,'payments','💳 Платіж очікує перевірки',name(p.driver_id)+' · '+money(p.amount),'payments',p.created_at,'important');if(!isOwner()&&p.status==='confirmed')add('payment-ok-'+p.id,'payments','✅ Платіж підтверджено',money(p.amount)+' зараховано власником','payments',p.confirmed_at||p.created_at);}
 for(const x of records.fleet_service_events||[]){if(!isOwner()||!x.due_date||x.completed_at)continue;const days=Math.ceil((new Date(x.due_date+'T23:59:59').getTime()-Date.now())/86400000);if(days<=7)add('service-'+x.id,'service','🔧 '+(days<0?'Прострочено ТО':'Наближається термін ТО'),carName(x.car_id)+' · '+x.title,'cars',x.created_at,days<0?'important':'normal');}
 if(isOwner())for(const x of records.fleet_damage_reviews||[]){if(x.owner_decision)continue;add('ai-'+x.id,'ai','✨ AI-огляд очікує рішення',carName(x.car_id),'nikcar-ai',x.created_at);}
 for(const item of records.days_off_notifications||[]){const day=(records.driver_days_off||[]).find(x=>x.id===item.day_off_id);const approved=item.kind==='approved';add('days-off-'+item.id,'daysOff',approved?'📅 Вихідні підтверджено':'📅 Вихідні скасовано',day?carName(day.vehicle_id)+' · '+day.date_from+' — '+day.date_to:'Оновлено статус безоплатних вихідних',isOwner()?'drivers':'notifications',item.created_at);}
  const fuel=records.fleet_fuel_price?.[0];if(fuel?.price_uah)add('fuel-'+fuel.updated_at,'fuel','⛽ Тариф Fuel Points',money(fuel.price_uah)+' / літр','payments',fuel.updated_at);
 return out.filter(x=>notificationState().settings[x.category]).sort((a,b)=>String(b.time).localeCompare(String(a.time))).slice(0,100);
}
function quietNow(){const h=new Date().getHours();return h>=23||h<8;}
function smartSound(category){const st=notificationState().settings;if(!st.sound||(st.quiet&&quietNow()))return;try{const C=window.AudioContext||window.webkitAudioContext;if(!C)return;const ctx=new C();const freq=category==='fines'?[700,520]:category==='payments'?[620,850]:category==='ai'?[540,720]:[650,880];freq.forEach((f,i)=>{const o=ctx.createOscillator(),g=ctx.createGain();o.type='sine';o.frequency.value=f;g.gain.setValueAtTime(.0001,ctx.currentTime+i*.15);g.gain.exponentialRampToValueAtTime(.045,ctx.currentTime+i*.15+.025);g.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+i*.15+.13);o.connect(g);g.connect(ctx.destination);o.start(ctx.currentTime+i*.15);o.stop(ctx.currentTime+i*.15+.14);});setTimeout(()=>ctx.close().catch(()=>{}),800);}catch{}if(st.vibrate&&navigator.vibrate)navigator.vibrate([80,40,80]);}
function notifyNewEvents(){
 if(!me||!sessionInitialized)return;const st=notificationState(),events=smartEvents();
 if(!st.seen.length){st.seen=events.map(x=>x.id);saveNotificationState(st);return;}
 const fresh=events.filter(x=>!st.seen.includes(x.id));if(!fresh.length)return;
 st.seen=[...st.seen,...fresh.map(x=>x.id)];saveNotificationState(st);
 const x=fresh[0];if(!st.quiet||!quietNow()){smartSound(x.category);if('Notification' in window&&Notification.permission==='granted'){void showNikcarSystemNotification(x.title,x.body,x.id).catch(console.warn);}}
}
async function registerNikcarWorker(){if(!('serviceWorker' in navigator)||!window.isSecureContext)return null;try{return await navigator.serviceWorker.register('./sw.js',{scope:'./'});}catch(err){console.warn('Push worker unavailable',err);return null;}}
async function showNikcarSystemNotification(title,body,tag){
 if(!('Notification' in window)||Notification.permission!=='granted')return false;
 const reg=await registerNikcarWorker();
 if(reg){await reg.showNotification(title,{body,tag,icon:'./icon.svg',badge:'./icon.svg',data:{url:location.origin+location.pathname}});return true;}
 new Notification(title,{body,tag,icon:'./icon.svg'});return true;
}
function notificationsPage(){
 const st=notificationState(),events=smartEvents(),unread=events.filter(x=>!st.read.includes(x.id)).length;
 const entries=events.map(x=>'<div class="line"><div><b>'+e(x.title)+'</b><div class="small">'+e(x.body)+'</div><div class="small">'+e(x.time?d(x.time):'')+(st.read.includes(x.id)?' · Переглянуто':' · Нове')+'</div></div><button class="btn secondary tiny" data-action="notification-open" data-id="'+e(x.id)+'">Відкрити</button></div>').join('');
 const options=[['ai','NikCar AI'],['fines','Штрафи'],['fuel','Fuel Points'],['payments','Платежі'],['service','ТО та страхування'],['daysOff','Безоплатні вихідні'],['quiet','Тихі години 23:00–08:00'],['sound','Звуки'],['vibrate','Вібрація']];
 const toggles=options.map(([k,label])=>'<label class="line"><span>'+label+'</span><input type="checkbox" data-notify-setting="'+k+'" '+(st.settings[k]?'checked':'')+'></label>').join('');
 return '<div class="cards"><section class="card"><h2>🔔 Центр сповіщень · '+unread+' нових</h2><p class="small">Події з даних NikCar. Системні сповіщення працюють, коли застосунок активний (навіть у фоновій вкладці). Для повідомлень після повного закриття застосунку потрібна серверна Web Push доставка.</p><div class="actions"><button class="btn secondary tiny" data-action="notification-read-all">Прочитати всі</button><button class="btn secondary tiny" data-action="notification-permission">Дозволити сповіщення</button><button class="btn secondary tiny" data-action="notification-test-sound">Тест звуку</button><button class="btn secondary tiny" data-action="notification-test-push">Тест системного сповіщення</button></div>'+entries+(entries?'':'<p>Нових подій немає.</p>')+'</section><section class="card"><h2>Налаштування</h2>'+toggles+'</section></div>';
}
const NIKCAR_API_URL='https://cvrbpeuadfxgumvmosni.supabase.co/functions/v1/nikcar-api';
let apiKeyList=null,apiNewSecret=null,apiLoading=false;
async function apiCall(action,method='GET',body){
 const {data:{session}}=await sb.auth.getSession();if(!session?.access_token)throw Error('Увійдіть до акаунта');
 const response=await fetch(NIKCAR_API_URL+'?action='+encodeURIComponent(action),{method,headers:{'Authorization':'Bearer '+session.access_token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 const data=await response.json();if(!response.ok)throw Error(data.error||'API error');return data;
}
async function refreshApiKeys(){if(apiLoading)return;apiLoading=true;try{apiKeyList=(await apiCall('list')).keys;render();}catch(err){toast(err.message||String(err));}finally{apiLoading=false;}}
function apiPage(){
 if(!isOwner())return '<div class="card">Доступ тільки власнику</div>';
 const keys=(apiKeyList||[]).map(k=>'<div class="line"><div><b>'+e(k.name)+'</b><div class="small">'+e(k.key_prefix)+'… · fleet:read · '+d(k.created_at)+'</div><div class="small">'+(k.revoked_at?'Відкликаний':k.expires_at&&Date.parse(k.expires_at)<Date.now()?'Прострочений':'Активний')+' · до '+d(k.expires_at)+'</div></div>'+(!k.revoked_at?'<button class="btn secondary tiny" data-action="api-revoke" data-id="'+e(k.id)+'">Відкликати</button>':'')+'</div>').join('');
 const secret=apiNewSecret?'<div class="banner warning"><b>Новий секретний ключ (показується лише зараз)</b><textarea readonly rows="3" id="api-secret-value">'+e(apiNewSecret)+'</textarea><button type="button" class="btn secondary" data-action="api-copy">Копіювати</button><p class="small">Збережіть ключ у менеджері секретів. Не вставляйте його у frontend або публічний репозиторій.</p></div>':'';
 return '<div class="cards"><section class="card"><h2>🔑 NikCar Developer API</h2><p class="small">Створюйте окремі ключі для зовнішніх інтеграцій. Наразі доступний лише читальний доступ до базових даних автопарку. Фінансові операції через ключі заборонені.</p>'+secret+'<form id="api-key-create-form" class="form"><label class="field">Назва інтеграції<input name="name" required maxlength="80" placeholder="Наприклад: GPS dashboard"></label><label class="field">Термін дії<select name="days"><option value="30">30 днів</option><option value="90" selected>90 днів</option><option value="365">365 днів</option></select></label><button class="btn" type="submit">Створити API-ключ</button></form><h3>Ключі</h3><button class="btn secondary tiny" data-action="api-refresh">Оновити список</button>'+ (apiKeyList===null?'<p class="small">Натисніть «Оновити список», щоб завантажити ключі.</p>':keys||'<p class="small">Ключів немає.</p>')+'</section><section class="card"><h2>Документація API · v1</h2><p><b>Базовий URL:</b></p><code>'+NIKCAR_API_URL+'</code><h3>Автентифікація</h3><p class="small">Для зовнішнього запиту передайте заголовок Authorization: Bearer nk_live_… . Для керування ключами використовується JWT власника з NikCar Fleet.</p><h3>GET ?action=fleet</h3><p class="small">Scope: fleet:read. Повертає JSON з масивом cars, полями id, plate, model, year, status. До 200 записів. Не містить VIN, фінансів або персональних даних водіїв.</p><h3>GET ?action=list</h3><p class="small">Тільки власник із JWT. Список ключів, префікси, терміни дії та статуси. Секрети не повертаються.</p><h3>POST ?action=create</h3><p class="small">Тільки власник із JWT. JSON: {"name":"My integration","days":90}. Відповідь містить одноразовий секрет key та record. Права: fleet:read.</p><h3>POST ?action=revoke</h3><p class="small">Тільки власник із JWT. JSON: {"id":"UUID ключа"}. Відкликає ключ негайно. Для ротації створіть новий ключ, переведіть інтеграцію і відкличте старий.</p><h3>Приклад запиту</h3><pre>curl -H "Authorization: Bearer YOUR_NIKCAR_KEY" \\n  "'+NIKCAR_API_URL+'?action=fleet"</pre><h3>Відповіді та безпека</h3><p class="small">200 — успіх; 201 — створено; 400 — некоректний запит; 401 — невалідний ключ; 403 — недостатні права; 404 — невідомий метод. Ключ показується лише один раз. Не використовуйте секрети в браузерному JavaScript. Ліміти запитів та IP allowlist ще не налаштовані.</p></section></div>';
}
let pointWallets=[],pointHistory=[],pointLoaded=false;
async function loadPoints(){
 if(!sb||!activeMember())return;
 const [w,h]=await Promise.all([sb.from('point_wallets').select('*').limit(300),sb.from('point_transactions').select('*').order('created_at',{ascending:false}).limit(100)]);
 if(w.error||h.error){toast('Point Balance: '+(w.error||h.error).message);return;}
 pointWallets=w.data||[];pointHistory=h.data||[];pointLoaded=true;if(page==='points')render();
}
function pointsPage(){
 const price=Number(records.fleet_fuel_price?.[0]?.price_uah||0);
 const mine=pointWallets.find(w=>w.driver_id===me.id);
 const owners=isOwner();
 const balances=owners?records.profiles.filter(p=>p.role==='driver').map(p=>pointWallets.find(w=>w.driver_id===p.id)||{driver_id:p.id,balance:0}):[mine||{driver_id:me.id,balance:0}];
 const cards=balances.map(w=>'<div class="line"><div><b>'+e(name(w.driver_id))+'</b><div><strong>'+money(w.balance)+' Points</strong></div><div class="small">'+(price?'≈ '+(Number(w.balance)/price).toFixed(2)+' л за поточною ціною':'Ціна дизеля не встановлена')+'</div></div></div>').join('');
 const history=pointHistory.map(t=>'<div class="line"><div><b>'+e(t.kind)+'</b> · '+e(name(t.driver_id))+'<div class="small">'+d(t.created_at)+' · '+e(t.reference||'')+(t.liters?' · '+t.liters+' л × '+money(t.price_uah):'')+'</div></div><strong>'+money(t.amount)+'</strong></div>').join('');
 const form=owners?'<section class="card"><h3>Провести операцію</h3><p class="small">Поповнення — лише після перевірки фактичного платежу. Для запобігання дублям вкажіть унікальний номер банківської транзакції.</p><form id="point-post-form" class="form"><label class="field">Водій<select name="driver" required>'+records.profiles.filter(p=>p.role==='driver').map(p=>'<option value="'+e(p.id)+'">'+e(p.full_name||p.phone||p.id)+'</option>').join('')+'</select></label><label class="field">Тип<select name="kind"><option value="topup">Підтверджене поповнення</option><option value="fuel">Заправка</option><option value="adjustment">Коригування (+/-)</option></select></label><label class="field">Сума Points (для поповнення/коригування)<input name="amount" type="number" step="0.01" value="0"></label><label class="field">Літри (для заправки)<input name="liters" type="number" min="0" step="0.001"></label><label class="field">Унікальний номер транзакції / операції<input name="reference" required minlength="5"></label><label class="field">Примітка<input name="notes"></label><button class="btn" type="submit">Перевірити й провести</button></form></section>':'';
 const driverGuide=!owners?'<section class="card"><h3>Поповнення паливних балів</h3><p>1 Point = 1 ₴. Після поповнення ви можете оплатити заправку балами за поточною ціною дизеля.</p><p class="small">Для поповнення перейдіть до розділу платежів, оберіть «Поповнення Fuel Points» і створіть заявку після переказу через Privat24. Власник звірить надходження та підтвердить зарахування.</p><button class="btn" data-action="nav" data-page="payments">Перейти до оплати</button></section>':'';return '<div class="cards"><section class="card"><div class="point-balance-hero"><div class="point-title"><img src="./icon.svg" alt="">Point Balance</div><div class="point-total">1 Point = 1 ₴</div><div class="point-details">Ціна дизеля: '+(price?money(price)+'/л':'не встановлена')+'</div></div><button class="btn secondary tiny" data-action="point-refresh">Оновити</button>'+(!pointLoaded?'<p>Завантаження балансу…</p>':cards||'<p class="small">Баланс 0 Points. Операцій ще немає.</p>')+'</section>'+driverGuide+form+'<section class="card"><h3>Історія Point Balance</h3>'+ (history||'<p class="small">Операцій немає.</p>')+'</section></div>';
}
function weeklyRentPanel(){
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const cars=isOwner()?records.cars:records.cars.filter(c=>records.rental_requests.some(r=>r.car_id===c.id&&r.driver_id===me.id&&r.handed_over_at));
 return `<section class="card"><h2>Оренда за тиждень</h2><p class="small">Оренда нараховується автоматично щопонеділка. Термін оплати — понеділок до 12:00 за Києвом. Нижче можна перевірити розрахунок за обраний тиждень.</p><form id="weekly-rent-form" class="form"><label class="field">Автомобіль<select name="car" required>${cars.map(c=>`<option value="${e(c.id)}">${e(c.model)} · ${e(c.plate)}</option>`).join('')}</select></label><label class="field">Перший день тижня<input type="date" name="start" required value="${e(today)}"></label><button class="btn" type="submit">Розрахувати тиждень</button></form><div id="weekly-rent-result" aria-live="polite"></div></section>`;
}
async function calculateWeeklyRent(form){
 const output=document.getElementById('weekly-rent-result'),button=form.querySelector('button[type=submit]');
 if(button.disabled)return;
 if(isOffline()){toast(offlineMessage());return;}
 const authId=user?.id;button.disabled=true;output.textContent='Розрахунок…';
 try{
  const values=new FormData(form),carId=String(values.get('car')),start=String(values.get('start'));
  const {weeklyRent}=await import('./v085-business.mjs?v=0.85.0');
  const period=weeklyRent({vehicleId:carId,weekStart:start,dailyRate:0});
  const [carResult,offResult]=await Promise.all([
   sb.from('cars').select('id,daily_rate,weekly_rate').eq('id',carId).single(),
   sb.from('driver_days_off').select('vehicle_id,date_from,date_to,status').eq('vehicle_id',carId).eq('status','approved').lte('date_from',period.weekEnd).gte('date_to',start)
  ]);
  if(carResult.error)throw carResult.error;if(offResult.error)throw offResult.error;
  if(!user||user.id!==authId||!output.isConnected)return;
  const amount=weeklyRent({vehicleId:carId,weekStart:start,dailyRate:Number(carResult.data.weekly_rate??Number(carResult.data.daily_rate)*7)/7,approved:offResult.data||[]});
  output.innerHTML=`<p>${e(amount.weekStart)} — ${e(amount.weekEnd)}</p><p>Тижнева ставка: <b>${money(amount.gross)}</b><br>Безоплатні дні: <b>${amount.freeDays}</b> · зменшення: <b>${money(amount.discount)}</b></p><h3>Оренда за тиждень: ${money(amount.due)}</h3><p class="small">За поточним тарифом автомобіля. Це сума оренди за обраний тиждень, без попередніх боргів і без віднімання проведених оплат.</p>`;
 }catch(err){if(user?.id===authId&&output.isConnected)output.textContent='Не вдалося розрахувати: '+(err.message||err);}
 finally{button.disabled=false;}
}

function nikcarDebtChart(rows,openingBalances=[]){
 const grouped=new Map();
 for(const r of rows){const id=r.driver_id;const current=grouped.get(id)||{driver:id,due:0,accrued:0,paid:0,overdue:0};const due=Math.max(0,Number(r.amount_due||0)-Number(r.paid_amount||0));current.due+=due;current.accrued+=Number(r.amount_due||0);current.paid+=Number(r.paid_amount||0);if(r.status==='overdue')current.overdue+=due;grouped.set(id,current);}
 for(const r of openingBalances){const id=r.driver_id;const current=grouped.get(id)||{driver:id,due:0,accrued:0,paid:0,overdue:0};const debt=Math.max(0,Number(r.amount||0)-Number(r.paid_amount||0));current.due+=debt;current.accrued+=Number(r.amount||0);current.paid+=Number(r.paid_amount||0);current.overdue+=debt;grouped.set(id,current);}
 const list=[...grouped.values()].sort((a,b)=>b.due-a.due);
 const total=list.reduce((n,x)=>n+x.due,0),max=Math.max(1,...list.map(x=>x.due));
 return '<div class="card"><h2>📊 Заборгованість за оренду</h2><p class="small">Автоматичне нарахування з дати фактичної видачі авто, за календарні дні до сьогодні. Підтверджені безоплатні дні зменшують нарахування; попередні борги залишаються.</p><h2 style="font-size:26px;margin:10px 0">'+money(total)+'</h2><div class="small">Загальна непогашена сума</div>'+ (list.length?list.map(x=>'<div style="margin:16px 0"><div style="display:flex;justify-content:space-between;gap:12px"><b>'+e(name(x.driver))+'</b><b>'+money(x.due)+'</b></div><div style="height:15px;background:#34383d;border-radius:12px;overflow:hidden;margin:8px 0"><div style="height:100%;width:'+Math.max(0,Math.min(100,x.due/max*100))+'%;background:'+(x.overdue>0?'#ef9a45':'#d8ff12')+';border-radius:12px"></div></div><div class="small">Нараховано: '+money(x.accrued)+' · Зараховано: '+money(x.paid)+' · Прострочено: '+money(x.overdue)+'</div></div>').join(''):'<p class="small">Нарахувань ще немає. Вони з’являться після видачі автомобіля.</p>')+'<button class="btn secondary tiny" data-action="nav" data-page="payments">Перейти до платежів</button></div>';
}
function rentDebtsPage(){if(!isOwner())return '<div class="banner warning">Доступ лише власнику</div>';return '<div id="nikcar-debt-chart"><div class="card">Завантаження нарахувань…</div></div>';}
async function nikcarRentRefresh(){
 if(!sb||!user)return;
 const expectedUser=user.id,expectedProfile=me?.id,target=document.getElementById('nikcar-rent-ledger'),debtTarget=document.getElementById('nikcar-debt-chart');
 const current=()=>user?.id===expectedUser&&me?.id===expectedProfile&&document.getElementById('nikcar-rent-ledger')===target;
 try{if(isOwner()){const {error}=await sb.rpc('nikcar_refresh_weekly_rent_v087');if(error)throw error;}
 if(!current()&&!debtTarget?.isConnected)return;
 const [rentResult,openingResult]=await Promise.all([sb.from('nikcar_weekly_rent').select('week_start,due_at,amount_due,paid_amount,status,car_id,driver_id').order('week_start',{ascending:false}).limit(1000),isOwner()?sb.from('nikcar_rent_opening_balances').select('rental_id,driver_id,car_id,amount,paid_amount'):Promise.resolve({data:[],error:null})]);const {data,error:readError}=rentResult;if(openingResult.error)throw openingResult.error;
 if(readError)throw readError;
 const el=target;if(!current()&&!debtTarget?.isConnected)return;
 if(debtTarget?.isConnected&&isOwner())debtTarget.innerHTML=nikcarDebtChart(data||[],openingResult.data||[]);
 if(!el||!current())return;
 el.innerHTML=(openingResult.data||[]).map(x=>'<div class="line"><div><b>'+e(carName(x.car_id))+'</b> · Початковий борг<div class="small">'+e(name(x.driver_id))+' · Перенесено з попереднього обліку</div></div><b>'+money(Math.max(0,Number(x.amount)-Number(x.paid_amount||0)))+'</b></div>').join('')+((data||[]).length?data.map(x=>'<div class="line"><div><b>'+e(carName(x.car_id))+'</b> · '+e(x.week_start)+'<div class="small">'+e(name(x.driver_id))+' · '+(x.status==='overdue'?'🔴 Прострочено':x.status==='paid'?'Сплачено':'Очікує оплати')+' · до понеділка 12:00</div></div><b>'+money(Math.max(0,Number(x.amount_due)-Number(x.paid_amount||0)))+'</b></div>').join(''):'<p class="small">Нових нарахувань поки немає.</p>');
 }catch(err){const el=target;if(el&&current())el.textContent='Не вдалося оновити нарахування: '+(err.message||err);if(debtTarget?.isConnected)debtTarget.textContent='Не вдалося оновити борги: '+(err.message||err);}
}
function paymentsPage(){
 const list=records.payment_claims.slice().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
 const rows=list.map(p=>`<div class="line"><div><b>${e(name(p.driver_id))}</b> · ${money(p.amount)}<div class="small">${e(carName(records.rental_requests.find(r=>r.id===p.rental_request_id)?.car_id))} · ${e(t(p.method))} · ${d(p.created_at)}</div>${p.driver_note?`<div class="small">${e(p.driver_note)}</div>`:''}${p.owner_note?`<div class="small">${e(p.owner_note)}</div>`:''}<div>${status(p.status)}</div></div>${isOwner()&&p.status==='declared'?`<div class="actions"><button class="btn tiny" data-action="confirm-payment" data-id="${e(p.id)}">${t('confirmPayment')}</button><button class="btn secondary tiny" data-action="reject-payment" data-id="${e(p.id)}">${t('rejectPayment')}</button></div>`:''}</div>`).join('');
 const eligible=records.rental_requests.filter(r=>r.driver_id===me.id&&r.status==='approved');
 const form=canApply()?`<div class="card"><h2>${t('paidClaim')}</h2><p class="small">Переказ на картку власника через Privat24. Після переказу поверніться сюди й повідомте про оплату; зарахування підтверджує лише власник.</p><a class="btn full" href="https://www.privat24.ua/send/k6mha" target="_blank" rel="noopener noreferrer" style="display:flex;justify-content:center;text-decoration:none;margin:10px 0">💳 Перейти до оплати через Privat24</a><div class="banner warning">${t('paymentHint')}</div>${eligible.length?`<form class="form" id="cash-payment-form"><label class="field">Призначення платежу<select name="purpose" required><option value="rent">Оренда автомобіля</option><option value="fuel_points">Поповнення Fuel Points (очікує зарахування)</option><option value="fine">Оплата штрафу</option></select></label><label class="field">${t('paymentChooseRental')}<select name="rental" required>${eligible.map(r=>`<option value="${e(r.id)}">${e(carName(r.car_id))} · ${d(r.created_at)}</option>`).join('')}</select></label><div class="row stack"><label class="field" style="flex:1">${t('paymentMethod')}<select name="method"><option value="card_transfer" selected>${t('card_transfer')}</option><option value="cash">${t('cash')}</option></select></label><label class="field" style="flex:1">${t('amount')}<input name="amount" type="number" step="0.01" min="0.01" max="1000000" required></label></div><label class="field">${t('paymentNote')}<textarea name="note" maxlength="450" placeholder="Час переказу або коментар"></textarea></label><p class="small">Усі три види оплат йдуть на одну картку через Privat24. Після звірки переказу в Privat24 власник підтверджує заявку за унікальним номером банківської операції. Points зараховуються одразу після підтвердження, повторне зарахування того самого переказу заблоковано.</p><button class="btn" type="submit">${t('paidClaim')}</button></form>`:`<p>${t('noApprovedRental')}</p>`}</div>`:'';
 return `<div class="banner warning">${isOwner()?t('paymentsOwnerHint'):t('paymentHint')}</div><section class="card"><h2>📅 Автоматичні нарахування оренди</h2><p class="small">Оплата щопонеділка до 12:00 (Київ). Прострочені нарахування виділяються окремо. Підтвердження оплати поки звіряється вручну.</p><div id="nikcar-rent-ledger"><p class="small">Завантаження…</p></div></section>${weeklyRentPanel()}${finesSection()}${fuelPriceSection()}${form}<div class="card"><h2>${t('paymentTitle')}</h2>${rows||`<p>${t('paymentNoData')}</p>`}</div>`;
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
function nikcarStoPage(){
 const staff=isOwner()||staffAssignments.some(a=>a.profile_id===me.id&&['mechanic','administrator'].includes(a.staff_role));
 const rentals=records.rental_requests.filter(r=>r.driver_id===me.id&&r.handed_over_at&&!r.returned_at);
 const cars=staff?records.cars:records.cars.filter(c=>rentals.some(r=>r.car_id===c.id));
 const form='<div class="card"><h2>Повідомити про несправність</h2><p class="small">Опишіть проблему та додайте фото. Заявка збережеться в кабінеті СТО.</p><form id="nikcar-sto-create" class="form"><label class="field">Автомобіль<select name="car" required>'+cars.map(c=>'<option value="'+e(c.id)+'">'+e(c.model)+' · '+e(c.plate)+'</option>').join('')+'</select></label><label class="field">Опис несправності<textarea name="description" required minlength="5" maxlength="4000" rows="4" placeholder="Що сталося, коли з’явилася проблема?"></textarea></label><label class="field">Фото несправності (до 5 МБ)<input type="file" name="photo" accept="image/jpeg,image/png,image/webp" capture="environment"></label><button class="btn" type="submit">Надіслати заявку</button></form></div>';
 const tickets=records.nikcar_service_tickets.filter(t=>staff||t.driver_id===me.id).map(t=>{
 const c=records.cars.find(c=>c.id===t.car_id),p=records.profiles.find(p=>p.id===t.driver_id);
 const photos=records.nikcar_service_photos.filter(x=>x.ticket_id===t.id);
 return '<div class="card"><h3>'+e(c?.model||'Авто')+' · '+e(c?.plate||'')+'</h3><p>'+e(t.description)+'</p><div class="small">'+e(p?.full_name||'Водій')+' · '+d(t.created_at)+' · '+e(({new:'Нова',in_progress:'У роботі',fixed:'Виправлено',closed:'Закрито'})[t.status]||t.status)+'</div>'+photos.map(x=>'<button class="btn secondary tiny" type="button" data-action="sto-photo" data-path="'+e(x.storage_path)+'">📷 Переглянути фото</button>').join('')+(t.mechanic_note?'<p><b>Коментар механіка:</b> '+e(t.mechanic_note)+'</p>':'')+(staff?'<form class="form" data-sto-update="'+e(t.id)+'"><label class="field">Статус<select name="status">'+['new','in_progress','fixed','closed'].map(v=>'<option value="'+v+'" '+(t.status===v?'selected':'')+'>'+({new:'Нова',in_progress:'У роботі',fixed:'Виправлено',closed:'Закрито'})[v]+'</option>').join('')+'</select></label><label class="field">Коментар механіка<textarea name="note" maxlength="4000">'+e(t.mechanic_note||'')+'</textarea></label><button class="btn" type="submit">Зберегти результат</button></form>':'')+'</div>';
 }).join('');
 return '<div class="cards">'+(cars.length?form:'<div class="banner">Немає активного автомобіля в оренді.</div>')+'<div class="card"><h2>Історія звернень</h2><p class="small">Заявки зберігаються для власника та водія.</p></div>'+tickets+'</div>';
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
const NIKCAR_VAPID_PUBLIC_KEY='BA1yTTKOPhBRsMjlQd_SCDZX6AJonemj6qdhtf12d9q-GGDu8ZCW6qzIh0Trmdes0Hb6CZyhEkNJItqwpgolhAI';
function nikcarVapidBytes(base64){const p=base64.replace(/-/g,'+').replace(/_/g,'/');const raw=atob(p+'='.repeat((4-p.length%4)%4));return Uint8Array.from(raw,c=>c.charCodeAt(0))}
async function nikcarEnablePush(){
 const expectedUser=user?.id,expectedProfile=me?.id;
 const assertSession=()=>{if(!expectedUser||!expectedProfile||user?.id!==expectedUser||me?.id!==expectedProfile||me?.access!=='active')throw Error('Акаунт змінився або неактивний. Увійдіть і повторіть спробу.');};
 assertSession();
 if(!('serviceWorker'in navigator)||!('PushManager'in window)||!('Notification'in window))throw Error('Цей браузер не підтримує Web Push. На iPhone додайте NikCar на початковий екран через Safari.');
 const permission=await Notification.requestPermission();if(permission!=='granted')throw Error('Дозвіл на сповіщення не надано');
 assertSession();await navigator.serviceWorker.register('./sw.js?v=0.89.0',{scope:'./'});const registration=await navigator.serviceWorker.ready;assertSession();
 let sub=await registration.pushManager.getSubscription();
 if(sub){const oldKey=sub.options?.applicationServerKey;const newKey=nikcarVapidBytes(NIKCAR_VAPID_PUBLIC_KEY);if(!oldKey||Array.from(new Uint8Array(oldKey)).join(',')!==Array.from(newKey).join(',')){await sub.unsubscribe();sub=null;}}if(!sub)sub=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:nikcarVapidBytes(NIKCAR_VAPID_PUBLIC_KEY)});
 assertSession();const json=sub.toJSON();const {error}=await sb.from('nikcar_push_subscriptions').upsert({profile_id:expectedProfile,endpoint:sub.endpoint,p256dh:json.keys.p256dh,auth_secret:json.keys.auth,user_agent:navigator.userAgent,updated_at:new Date().toISOString()},{onConflict:'endpoint'});
 if(error)throw error;
 assertSession();toast('Пристрій зареєстровано для push-сповіщень');
}
function accountPage(){return `<div class="cards account-grid"><div class="card"><h2>${t('accountState')}</h2><div class="line"><span>${t('role')}</span>${status(me.role)}</div><div class="line"><span>${t('access')}</span>${status(me.access)}</div><form class="form" id="profile-update" style="margin-top:14px"><div class="profile-photo-row">${me.avatar_path?privatePhoto(me.avatar_path,'driver-avatar large',me.full_name,'./icon.svg'):'<span class="driver-avatar large driver-initial">' + e((me.full_name||'?').trim().charAt(0).toUpperCase()) + '</span>'}<label class="field">Фото профілю (до 5 МБ)<input name="avatar_photo" type="file" accept="image/jpeg,image/png,image/webp"></label></div><label class="field">${t('fullname')}<input name="fullname" maxlength="150" value="${e(me.full_name)}"></label><label class="field">${t('phone')}<input name="phone" maxlength="40" value="${e(me.phone||'')}"></label><button class="btn" type="submit">${t('saveProfile')}</button></form></div><div class="card"><h2>🔔 Push-сповіщення</h2><p class="small">Дозвольте сповіщення, щоб отримувати повідомлення NikCar на цьому пристрої. На iPhone відкрийте встановлений на початковому екрані застосунок.</p><button class="btn" type="button" id="nikcar-push-enable">Увімкнути сповіщення</button><p class="small">Реєстрація пристрою доступна. Серверна доставка повідомлень ще налаштовується.</p></div><div class="card"><h2>${t('account')}</h2><p>${e(user.email||'')}</p><p>${t('deleteNotice')}</p><p class="banner warning">${t(isOwner()?'paymentsStatus':'paymentHint')}</p><button class="btn secondary" data-action="change-password">${lang==='uk'?'Змінити пароль':'Change password'}</button> <button class="btn secondary" data-action="signout">${t('signout')}</button></div></div>`}
let passportOcrBusy=false;
const passportOcrQueue=[];
const pendingPassportPhotos={front:null,back:null};
function updatePassportAttachments(){const el=document.getElementById('tech-passport-attachments');if(el)el.textContent='Лицьова: '+(pendingPassportPhotos.front?.name||'не вибрана')+' · Зворотна: '+(pendingPassportPhotos.back?.name||'не вибрана')+'. Фото зберігаються після створення авто.';}
function clearPendingPassportPhotos(){pendingPassportPhotos.front=null;pendingPassportPhotos.back=null;passportOcrQueue.length=0;for(const id of ['tech-passport-photo','tech-passport-back-photo']){const input=document.getElementById(id);if(input)input.value='';}updatePassportAttachments();}
function parseTechPassport(text){
 const raw=String(text||'').replace(/\u00a0/g,' ').replace(/[‐‑–—]/g,'-');
 const lines=raw.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
 const joined=lines.join(' ');
 // Ukrainian registration certificate: field codes are printed in a separate column.
 const field=(key)=>{
  const re=new RegExp('(?:^|\\s)\\(?'+key.replace('.','\\.')+'\\)?(?=\\s|[:.\\-]|$)','i');
  for(let i=0;i<lines.length;i++){
   const match=lines[i].match(re);if(!match)continue;
   const tail=lines[i].slice(match.index+match[0].length).replace(/^[\s:;.\-]+/,'').trim();
   if(tail)return tail;
   for(let j=i+1;j<Math.min(lines.length,i+3);j++){
    if(/^\(?[A-HJ-Z](?:\.\d)?\)?(?:\s|$)/i.test(lines[j]))break;
    if(lines[j].trim())return lines[j].trim();
   }
  }
  return '';
 };
 const labeled=(re)=>{
  for(let i=0;i<lines.length;i++){
   const match=lines[i].match(re);if(!match)continue;
   const tail=lines[i].slice(match.index+match[0].length).replace(/^[\s:;.\-]+/,'').trim();
   if(tail)return tail;
   return lines[i+1]||'';
  }
  return '';
 };
 const normalizeLetters=v=>String(v||'').toUpperCase().replace(/[АВЕКМНОРСТУХІЇЄ]/g,c=>({'А':'A','В':'B','Е':'E','К':'K','М':'M','Н':'H','О':'O','Р':'P','С':'C','Т':'T','У':'Y','Х':'X','І':'I','Ї':'I','Є':'E'}[c]||c));
 const plateSource=labeled(/^\s*(?:державний\s*номер|номерний\s*знак|реєстраційний\s*номер|license\s*plate|registration\s*mark)\s*[:\-]/i)||field('A');
 const plateClean=normalizeLetters(plateSource).replace(/[\s-]/g,'');
 let plateToken=plateClean.match(/[A-Z]{2}[0-9O]{4}[A-Z]{2}(?![A-Z0-9])/)||null;
 if(!plateToken){
  const candidates=[...normalizeLetters(joined).matchAll(/(?:^|[^A-Z0-9])([A-Z]{2}[0-9O]{4}[A-Z]{2})(?![A-Z0-9])/g)].map(m=>m[1]);
  const unique=[...new Set(candidates)];
  if(unique.length===1)plateToken=[unique[0]];
 }
 const plate=plateToken?plateToken[0].replace(/O/g,(ch,i)=>i>=2&&i<=5?'0':ch):'';
 const make=labeled(/^\s*(?:марка|make|brand)\s*[:\-]/i)||field('D.1');
 const model=labeled(/^\s*(?:модель|model)\s*[:\-]/i)||field('D.3');
 const brandCandidates=['RENAULT','VOLKSWAGEN','TOYOTA','FORD','MERCEDES','BMW','AUDI','SKODA','OPEL','PEUGEOT','CITROEN','HYUNDAI','KIA','NISSAN','FIAT','DACIA','MAZDA','HONDA','MITSUBISHI','CHEVROLET','VOLVO'];
 const modelPart=String(model||'').replace(/\s{2,}.*/,'').trim();
 const brandFromText=brandCandidates.find(x=>new RegExp('(?:^|[^A-Z])'+x+'(?:$|[^A-Z])','i').test(joined))||'';
 const makePart=String(make||'').replace(/\s{2,}.*/,'').trim();
 const brand=makePart||brandFromText;
 const cleanedModel=[brand,modelPart].filter((x,i,arr)=>x&&!(i&&arr[0].toUpperCase()===x.toUpperCase())).join(' ').slice(0,120);
 const vinSource=labeled(/^\s*(?:VIN|номер кузова|ідентифікаційний номер)\s*[:\-]/i)||field('E');
 const vin=(normalizeLetters(vinSource).match(/[A-HJ-NPR-Z0-9]{17}(?![A-Z0-9])/)||normalizeLetters(raw).match(/\b[A-HJ-NPR-Z0-9]{17}\b/)||[])[0]||'';
 const yearSource=labeled(/^\s*(?:рік випуску|рік виробництва|year of manufacture|рік виготовлення)\s*[:\-]/i)||field('B.2');
 let year=(yearSource.match(/\b(?:19|20)\d{2}\b/)||[])[0]||'';
 if(!year){
  const years=lines.filter(x=>/^(?:19|20)\d{2}$/.test(x));
  if(years.length===1)year=years[0];
  if(!year){const match=joined.match(/(?:\(?B\s*[.·:]\s*2\)?|YEAR\s+OF\s+MANUFACTURE|РІК\s+ВИПУСКУ)\s*[:\-]?\s*((?:19|20)\d{2})/i);if(match)year=match[1];}
 }

 const certSource=labeled(/^\s*(?:серія(?:\s+та)?\s+номер(?:\s+свідоцтва|\s+техпаспорта)?|номер\s+свідоцтва|registration\s+certificate|certificate\s*(?:number|no\.?))\s*[:\-]/i);
 // Prefer explicit №: the serial at the bottom is not field A (vehicle plate).
 const certText=String(certSource+'\n'+raw).toUpperCase();
 const certPattern=/(?:^|[^A-ZА-ЯІЇЄ0-9])([A-ZА-ЯІЇЄ]{3})\s*(?:№|N[OО°º.]?[EЕ]?|М[ОO]|NO\.)\s*([0-9OОІI]{6})(?![A-ZА-ЯІЇЄ0-9])/g;
 const explicit=[...certText.matchAll(certPattern)];
 const plain=[...certText.matchAll(/(?:^|[^A-ZА-ЯІЇЄ0-9])([A-ZА-ЯІЇЄ]{3})\s+(\d{6})(?![A-ZА-ЯІЇЄ0-9])/g)];
 const normalizeSeries=v=>v.replace(/[CTIXABEKMHOP]/g,c=>({'C':'С','T':'Т','I':'І','X':'Х','A':'А','B':'В','E':'Е','K':'К','M':'М','H':'Н','O':'О','P':'Р'}[c]));
 const candidates=(explicit.length?explicit:plain).map(m=>normalizeSeries(m[1])+' № '+m[2].replace(/[OО]/g,'0').replace(/[ІI]/g,'1'));
 const uniqueCerts=[...new Set(candidates)];
 const registration_certificate=uniqueCerts.length===1?uniqueCerts[0]:'';

 return {plate,model:cleanedModel,year,vin,registration_certificate};
}
function applyPassportOcrFields(values){
 const form=document.getElementById('new-car');if(!form)return 0;
 let filled=0;
 for(const name of ['plate','model','vin','year','registration_certificate']){
  const field=form.elements.namedItem(name);
  if(!field||!values[name])continue;
  if(field.value.trim()&&field.dataset.ocrFilled!=='1')continue;
  if(name==='plate'&&field.value.trim()&&field.value.trim()!==values[name])continue;
  if(field.value.trim()===values[name])continue;
  field.value=values[name];field.dataset.ocrFilled='1';filled++;
 }
 if(filled){form.dataset.dirty='1';captureNewCarDraft();}
 const vinPreview=document.getElementById('tech-passport-vin');
 if(vinPreview&&form.elements.namedItem('vin')?.value)vinPreview.textContent='VIN: '+form.elements.namedItem('vin').value+' · перевірте правильність';
 return filled;
}
async function readTechPassport(file){
 const status=document.getElementById('tech-passport-status');
 if(!status||!isOwner())return;
 if(passportOcrBusy){passportOcrQueue.push(file);status.textContent='Фото додано. Очікує розпізнавання…';return;}
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||!file.size||file.size>5*1024*1024){status.textContent='Лише JPG, PNG, WebP до 5 МБ';return;}
 passportOcrBusy=true;status.textContent='Підготовка розпізнавання…';
 let worker=null;
 try{
  if(!window.Tesseract)await new Promise((ok,fail)=>{
   const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';script.onload=ok;script.onerror=fail;document.head.appendChild(script);
  });
  worker=await window.Tesseract.createWorker('eng+ukr',1);
  let best={};let filled=0;const scores={};
  const merge=(found,confidence=0)=>{
   for(const key of ['plate','model','vin','year','registration_certificate']){
    if(found[key]&&(!best[key]||confidence>(scores[key]||0))){best[key]=found[key];scores[key]=confidence;}
   }
  };
  let bitmap=null;
  try{bitmap=await createImageBitmap(file);}catch(_){}
  if(bitmap){
   try{
    const ratio=Math.min(2,2200/Math.max(bitmap.width,bitmap.height));
    const w=Math.max(1,Math.round(bitmap.width*ratio)),h=Math.max(1,Math.round(bitmap.height*ratio));
    const angles=[0,90,270,180];let bestAngle=0,bestOrientationScore=-1;
    const draw=(angle)=>{
     const rotated=angle===90||angle===270,canvas=document.createElement('canvas');
     canvas.width=rotated?h:w;canvas.height=rotated?w:h;
     const ctx=canvas.getContext('2d');ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(angle*Math.PI/180);ctx.drawImage(bitmap,-w/2,-h/2,w,h);return canvas;
    };
    await worker.setParameters({tessedit_pageseg_mode:'11',preserve_interword_spaces:'1'});
    for(let i=0;i<angles.length;i++){
     const angle=angles[i];
     status.textContent='Розпізнавання техпаспорта: '+(i+1)+'/4 орієнтацій…';
     const canvas=draw(angle);
     const scan=await worker.recognize(canvas);const found=parseTechPassport(scan.data.text||'');
     const score=Object.values(found).filter(Boolean).length*100+(scan.data.confidence||0);
     if(score>bestOrientationScore){bestOrientationScore=score;bestAngle=angle;}
     merge(found,scan.data.confidence||0);
     canvas.width=1;canvas.height=1;
     if(best.plate&&best.vin&&best.model&&best.year&&best.registration_certificate)break;
    }
    status.textContent='Уточнення дрібного тексту та номера техпаспорта…';
    const oriented=draw(bestAngle);
    try{
     // Lower half includes the document serial; enlarge it without shrinking the whole card.
     const crop=document.createElement('canvas');const top=Math.floor(oriented.height*0.45);
     const scale=Math.min(2,2600/oriented.width);crop.width=Math.round(oriented.width*scale);crop.height=Math.round((oriented.height-top)*scale);
     const ctx=crop.getContext('2d');ctx.drawImage(oriented,0,top,oriented.width,oriented.height-top,0,0,crop.width,crop.height);
     const pixels=ctx.getImageData(0,0,crop.width,crop.height);
     for(let k=0;k<pixels.data.length;k+=4){const gray=0.299*pixels.data[k]+0.587*pixels.data[k+1]+0.114*pixels.data[k+2];const v=Math.max(0,Math.min(255,(gray-128)*1.5+128));pixels.data[k]=pixels.data[k+1]=pixels.data[k+2]=v;}
     ctx.putImageData(pixels,0,0);
     const detail=await worker.recognize(crop);const cert=parseTechPassport(detail.data.text||'').registration_certificate;
     if(cert)merge({registration_certificate:cert},detail.data.confidence||0);
     crop.width=1;crop.height=1;
     if(!best.year||!best.vin||!best.model||!best.plate){
      await worker.setParameters({tessedit_pageseg_mode:'6'});
      const block=await worker.recognize(oriented);merge(parseTechPassport(block.data.text||''),block.data.confidence||0);
     }
    }catch(err){console.warn('Passport detail scan failed',err);}finally{oriented.width=1;oriented.height=1;}
   }finally{bitmap.close();}
  }else{
   status.textContent='Розпізнавання техпаспорта…';
   const scan=await worker.recognize(file);merge(parseTechPassport(scan.data.text||''));
  }
  filled=applyPassportOcrFields(best);
  const form=document.getElementById('new-car');const present=['plate','model','vin','year','registration_certificate'].filter(key=>form?.elements.namedItem(key)?.value?.trim());const missing=['plate','model','vin','year','registration_certificate'].filter(key=>!present.includes(key));status.textContent=(filled?'Додано '+filled+' нових полів. ':'')+'Заповнено '+present.length+'/5. '+(missing.length?'Ще потрібно перевірити: '+missing.map(x=>({plate:'держномер',model:'марку й модель',vin:'VIN',year:'рік',registration_certificate:'серію техпаспорта'}[x])).join(', ')+'.':'Перевірте дані перед збереженням.');
 }catch(err){console.warn('Passport OCR failed',err);status.textContent='Розпізнавання не завершилось. Фото прикріплені; можна повторити або заповнити вручну.';}
 finally{
  if(worker)try{await worker.terminate();}catch(_){}
  passportOcrBusy=false;updatePassportAttachments();
  const next=passportOcrQueue.shift();if(next)void readTechPassport(next);
 }
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
   newCarDraft={userId:user.id,values:Object.fromEntries(['model','plate','vin','year','rate','registration_certificate'].map(k=>[k,typeof values[k]==='string'?values[k]:'']))};
  }
 }catch(_){}
}
document.addEventListener('input',ev=>{if(ev.target?.name==='year'&&ev.target?.form?.id&&['new-car','edit-car-form'].includes(ev.target.form.id))ev.target.setCustomValidity('');});
function requestManualCarYear(form){
 const field=form?.elements?.namedItem('year');if(!field)return false;
 if(String(field.value||'').trim())return false;
 field.setCustomValidity('Вкажіть рік випуску автомобіля вручну. Дата оновлення Дії не є роком випуску.');
 field.focus();field.reportValidity();
 const status=document.getElementById('tech-passport-status');if(status)status.textContent='⚠️ Рік випуску не визначено. Введіть фактичний рік вручну перед збереженням.';
 return true;
}
function captureNewCarDraft(){
 const form=document.getElementById('new-car');
 if(!form?.elements?.namedItem||!user||!isOwner())return;
 newCarDraft={userId:user.id,values:Object.fromEntries(['model','plate','vin','year','rate','registration_certificate'].map(name=>[name,form.elements.namedItem(name)?.value||'']))};
 saveNewCarDraft();
}
function clearNewCarForm(){
 clearPendingPassportPhotos();
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
  if(!form.id||['auth-form','profile-update','chat-send'].includes(form.id)||form.dataset.submitting==='1')continue;
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
  if(!form.id||form.id==='new-car'||form.dataset.submitting==='1')continue;
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
function render(){captureOwnerUiDraft();captureNewCarDraft();document.documentElement.lang=lang;if(!configured){root.innerHTML=configuredPage();return;}if(!sb){root.innerHTML='<div class="loading">NikCar · Cloud Pilot</div>';return;}if(!user||recoveryMode){root.innerHTML=authPage();return;}if(!me){root.innerHTML=`<div class="auth-layout"><div class="auth-box"><h1>${t('notFound')}</h1><button class="btn" data-action="refresh">${t('reload')}</button><button class="btn secondary" data-action="signout">${t('signout')}</button></div></div>`;return;}const titles={dashboard:t('dashboardTitle'),drivers:t('driversTitle'),announcements:t('announcements'),cars:t('cars'),requests:t('requestTitle'),documents:isOwner()?t('docOwnerView'):t('docsTitle'),chat:t('chatTitle'),'nikcar-ai':'NikCar AI',sos:t('sosTitle'),account:t('account'),tracking:'GPS / Техніка',payments:t('paymentTitle'),notifications:'🔔 Smart Notifications',points:'Point Balance',api:'API та інтеграції','days-off':'📅 Безоплатні вихідні','rent-debts':'📊 Борги за оренду',settings:'⚙ Налаштування',repairs:t('repairTitle'),sto:'🔧 СТО · Заявки'};const b={'rent-debts':rentDebtsPage,points:pointsPage,'days-off':daysOffPage,settings:settingsPage,api:apiPage,notifications:notificationsPage,payments:paymentsPage,repairs:repairsPage,sto:nikcarStoPage,dashboard:dashboardPage,drivers:driversPage,announcements:announcementsPage,cars:carsPage,requests:requestsPage,documents:documentsPage,chat:chatPage,'nikcar-ai':nikcarAiPage,tracking:trackingPage,sos:sosPage,account:accountPage};root.innerHTML=layout(b[page](),titles[page]);if(page==='payments'||page==='rent-debts'||(page==='dashboard'&&isOwner()))void nikcarRentRefresh();if(page==='account'){const btn=document.getElementById('nikcar-push-enable');if(btn)btn.onclick=async()=>{btn.disabled=true;try{await nikcarEnablePush()}catch(err){toast(err.message||'Не вдалося увімкнути сповіщення')}finally{btn.disabled=false}};}if(page==='points'&&!pointLoaded)loadPoints();if(page==='nikcar-ai'&&!aiMemoryLoaded)void refreshAiMemory(true);void hydratePrivatePhotos();restoreNewCarDraft();restoreOwnerUiDraft();updatePassportAttachments();if(page==='chat'){const el=document.getElementById('messages');if(el)el.scrollTop=el.scrollHeight;}}
let lastRecordsUserId=null;
let partialLoadWarningShown=false;
async function load({preserveDraft=false}={}){
 if(!sb||!user){me=null;records=emptyRecords();render();return;}
 const expectedUserId=user.id,version=++loadVersion;
 let accessChanged=false;
 try{
  const {data,error}=await sb.from('profiles').select('id,user_id,full_name,phone,role,access,created_at,avatar_path').eq('user_id',expectedUserId).maybeSingle();
  if(version!==loadVersion||user?.id!==expectedUserId)return;
  if(error)throw error;
  accessChanged=(me?.role||'')!==(data?.role||'')||(me?.access||'')!==(data?.access||'');
  me=data;
  if(me&&isOwner()&&!sessionInitialized)page='dashboard';void refreshStaffAssignments().then(changed=>{if(changed&&!hasUnsavedForm()&&(page==='drivers'||page==='sto'||page==='dashboard')){if(isMechanic()&&page==='drivers')page='sto';render();}}).catch(err=>console.warn('Staff refresh unavailable',err));
  if(me&&activeMember())startChatPresence();
  sessionInitialized=true;
  if(me){
   const targets=[sb.from('driver_days_off').select('*').order('created_at',{ascending:false}).limit(500),sb.from('days_off_notifications').select('*').order('created_at',{ascending:false}).limit(100),sb.from('payment_claims').select('*').order('created_at',{ascending:false}).limit(250),sb.from('nikcar_service_tickets').select('*').order('created_at',{ascending:false}).limit(250),sb.from('nikcar_service_photos').select('*').limit(500),sb.from('repair_jobs').select('*').order('created_at',{ascending:false}).limit(150),sb.from('repair_parts').select('*').limit(500),sb.from('expense_entries').select('*').limit(200),sb.from('fleet_service_events').select('*').order('created_at',{ascending:false}).limit(500),sb.from('fleet_files').select('*').order('created_at',{ascending:false}).limit(250),sb.from('fleet_inspections').select('*').order('inspected_at',{ascending:false}).limit(250),sb.from('fleet_damage_reviews').select('*').order('created_at',{ascending:false}).limit(100),sb.from('fleet_tracking_assets').select('*').order('created_at',{ascending:false}).limit(300),sb.from('fleet_fines').select('*').order('created_at',{ascending:false}).limit(300),sb.from('rental_damage_photos').select('*').order('created_at',{ascending:false}).limit(300),sb.from('fleet_fuel_price').select('*'),sb.from('fleet_fuel_price_history').select('*').order('changed_at',{ascending:false}).limit(30),sb.from('cars').select('*').order('model'),sb.from('rental_requests').select('*').order('created_at',{ascending:false}).limit(150),sb.from('chat_messages').select('*').order('created_at',{ascending:true}).limit(100),sb.from('sos_requests').select('*').order('created_at',{ascending:false}).limit(100),sb.from('profiles').select('id,user_id,full_name,phone,role,access,avatar_path'),sb.from('driver_documents').select('id,driver_id,car_id,kind,object_path,created_at'),sb.from('announcements').select('*').order('pinned',{ascending:false}).order('created_at',{ascending:false}).limit(80)];
   const loaded=await Promise.allSettled(targets);
   if(version!==loadVersion||user?.id!==expectedUserId)return;
   const keys=['driver_days_off','days_off_notifications','payment_claims','nikcar_service_tickets','nikcar_service_photos','repair_jobs','repair_parts','expense_entries','fleet_service_events','fleet_files','fleet_inspections','fleet_damage_reviews','fleet_tracking_assets','fleet_fines','rental_damage_photos','fleet_fuel_price','fleet_fuel_price_history','cars','rental_requests','chat_messages','sos_requests','profiles','driver_documents','announcements'];
   const nextRecords=emptyRecords();
   const failed=[];
   for(let i=0;i<loaded.length;i++){
    const result=loaded[i];const response=result.status==='fulfilled'?result.value:null;
    if(result.status==='rejected'||response?.error){failed.push(keys[i]);nextRecords[keys[i]]=lastRecordsUserId===expectedUserId?(records[keys[i]]||[]):[];continue;}
    nextRecords[keys[i]]=response?.data||[];
   }
   records=nextRecords;lastRecordsUserId=expectedUserId;
   if(failed.length){console.warn('NikCar partial refresh:',failed.join(', '));if(!partialLoadWarningShown){toast('Частину даних не оновлено. Перевірте інтернет і повторіть оновлення.');partialLoadWarningShown=true;}}
   else partialLoadWarningShown=false;
   notifyNewEvents();
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
async function clickAction(btn){const a=btn.dataset.action,id=btn.dataset.id;if(a==='cancel-days-off'){if(!isOwner()||!id||!window.confirm('Скасувати безоплатні вихідні? Ці дні знову враховуватимуться у вартості тижневої оренди.'))return;const {error}=await sb.rpc('nikcar_cancel_days_off_v085',{p_id:id});if(error)throw error;forceMutationRefresh++;await load();toast('Вихідні скасовано');return;}if(a==='point-refresh'){await loadPoints();return;}
if(a==='api-refresh'){await refreshApiKeys();return;}
if(a==='api-copy'){if(apiNewSecret){await navigator.clipboard.writeText(apiNewSecret);toast('Ключ скопійовано');}return;}
if(a==='api-revoke'){if(!isOwner()||!window.confirm('Відкликати ключ? Інтеграція втратить доступ.'))return;await apiCall('revoke','POST',{id});apiKeyList=null;await refreshApiKeys();toast('Ключ відкликано');return;}
if(a==='enable-push'){try{await nikcarEnablePush();}catch(err){toast(err.message||String(err));}return;}if(a==='notification-permission'){if(!('Notification' in window)){toast('Браузер не підтримує сповіщення');return;}const result=await Notification.requestPermission();if(result==='granted')await registerNikcarWorker();toast(result==='granted'?'Сповіщення дозволено':'Дозвіл не надано');return;}if(a==='notification-test-push'){try{const shown=await showNikcarSystemNotification('NikCar · Тест сповіщення','Сповіщення на цьому пристрої працюють.','nikcar-test');toast(shown?'Тестове сповіщення надіслано':'Спочатку дозвольте сповіщення');}catch(err){toast(err.message||String(err));}return;}if(a==='notification-test-sound'){smartSound('payments');toast('Тест сигналу');return;}if(a==='notification-read-all'){const st=notificationState();st.read=[...new Set([...st.read,...smartEvents().map(x=>x.id)])];saveNotificationState(st);render();return;}if(a==='notification-open'){const event=smartEvents().find(x=>x.id===id);if(!event)return;const st=notificationState();st.read=[...st.read,id];saveNotificationState(st);page=event.page;render();return;}if(a==='cancel-fine'){if(!isOwner()||!window.confirm('Скасувати помилкове нарахування штрафу?'))return;await mutation(sb.from('fleet_fines').update({status:'cancelled'}).eq('id',id).eq('status','assigned').select('id'),'Нарахування скасовано');return;}if(a==='rename-tracking-asset'){if(!isOwner())return;const form=document.getElementById('tracking-rename-'+id);if(!form||!form.reportValidity())return;const title=String(new FormData(form).get('title')||'').trim();if(title.length<2)return;const {data,error}=await sb.from('fleet_tracking_assets').update({title}).eq('id',id).select('id');if(error){toast(error.message);return;}if(!data?.length){toast('Назву не змінено');return;}forceMutationRefresh++;await load();toast('Назву трекера оновлено');return;}
 if(a==='delete-tracking-asset'){if(!isOwner())return;const item=records.fleet_tracking_assets.find(x=>x.id===id);if(!item)return;if(!window.confirm('Видалити '+item.title+' з GPS-реєстру?'))return;const {data,error}=await sb.from('fleet_tracking_assets').delete().eq('id',id).select('id');if(error){toast(error.message);return;}if(!data?.length){toast('Запис не видалено');return;}forceMutationRefresh++;await load();return;}
 if(a==='damage-decision'){
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
 if(a==='service-done'){if(!isOwner())return;return mutation(sb.from('fleet_service_events').update({completed_at:new Date().toISOString()}).eq('id',id));}if(a==='toggle-theme'){applyTheme(theme==='light'?'dark':'light');return;}if(a==='sto-photo'){const path=btn.dataset.path;const {data,error}=await sb.storage.from('nikcar-service').createSignedUrl(path,120);if(error)throw error;window.open(data.signedUrl,'_blank','noopener');return;}if(a==='choose-doc-photo'){const input=document.getElementById(btn.dataset.inputId);if(!input)return;if(input.dataset.docKind?.startsWith('rental_contract')&&!input.dataset.car){toast('Спочатку виберіть автомобіль у полі вище');document.getElementById('document-car')?.focus();return;}input.value='';input.click();return;}if(a==='contract-tenant-fill'){nikcarFillTenant();return;}if(a==='contract-tenant-ocr'){await nikcarOcrTenant();return;}if(a==='sign-rental-contract'){nikcarOpenSignature(id);return;}if(a==='print-rental-contract'){nikcarPrintRentalContract();return;}if(a==='nav'){showMore=false;if(btn.dataset.page==='documents'&&isOwner())selectedDriverId=null;page=btn.dataset.page;render();window.scrollTo(0,0);return;}if(a==='more'){showMore=!showMore;render();return;}if(a==='auth-mode'){mode=btn.dataset.value;authNotice='';authNoticeIsError=false;render();return;}if(a==='change-password'){if(!user)return;setRecoveryMode(true);authNotice='';render();return;}if(a==='cancel-recovery'){setRecoveryMode(false);authNotice='';render();return;}if(a==='auth-method'||a==='auth-small-link'){authMethod=btn.dataset.value==='magic'?'magic':'password';authNotice='';authNoticeIsError=false;render();return;}if(a==='refresh'){await load();return;}if(a==='signout'){const {error}=await sb.auth.signOut();if(error)throw error;if(chatPresenceChannel){void sb?.removeChannel(chatPresenceChannel);chatPresenceChannel=null;chatPresenceUser=null;chatOnlineUsers=new Set();}user=null;currentAuthUserId=null;clearAccountState();setRecoveryMode(false);render();return;}if(a==='oauth'){if(!oauthEnabled[btn.dataset.provider]){authNotice=t('oauthNotReady');render();return;}try{const redirectTo=authRedirect;const {error}=await sb.auth.signInWithOAuth({provider:btn.dataset.provider,options:{redirectTo}});if(error)throw error;}catch(err){authNotice=t('oauthNotReady');toast(err.message||authNotice);render()}return;}if(a==='resend-confirm'){const email=(document.querySelector('#auth-form input[name="email"]')?.value||lastAuthEmail||'').trim();if(!email){toast(lang==='uk'?'Вкажіть email у формі вище.':'Enter your email in the form above.');return;}try{assertAuthEmailCooldown();btn.disabled=true;const {error}=await sb.auth.resend({type:'signup',email:String(email).trim().toLowerCase(),options:{emailRedirectTo:authRedirect}});if(error)throw error;markAuthEmailSent();authNoticeIsError=false;authNotice=lang==='uk'?'Якщо адреса очікує підтвердження, лист буде надіслано. Перевірте пошту й «Спам».':'If this address is awaiting confirmation, an email will be sent. Check your inbox and spam.';render();}catch(err){authNotice=authErrorMessage(err,'resend');authNoticeIsError=true;render();}finally{if(btn.isConnected)btn.disabled=false;}return;}if(!sb||!me)return;
 if(a==='select-repair'){currentRepair=id;page='repairs';render();return;}
 if(a==='voice-repair'){const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){toast(t('repairVoiceUnavailable'));return;}const speech=new SR();speech.lang=lang==='uk'?'uk-UA':'en-US';speech.interimResults=false;speech.maxAlternatives=1;speech.onresult=event=>{const input=document.getElementById('repair-voice-target');if(input)input.value=(input.value+' '+event.results[0][0].transcript).trim();};speech.onerror=()=>toast(t('repairVoiceUnavailable'));speech.start();return;}
 if(a==='confirm-payment'||a==='reject-payment'){if(!isOwner())return;const pay=records.payment_claims.find(p=>p.id===id);if(!pay||pay.status!=='declared')return;const proceed=window.confirm(`${t(a==='confirm-payment'?'confirmPayment':'rejectPayment')} · ${money(pay.amount)}?`);if(!proceed)return;if(a==='confirm-payment'&&pay.driver_note?.startsWith('[fuel_points]')){
  const bankRef=window.prompt('Звірте реальне надходження у Privat24. Введіть унікальний номер банківської операції (не номер картки). Без перевірки не підтверджуйте платіж:');
  if(bankRef===null)return;
  if(bankRef.trim().length<5){toast('Вкажіть номер банківської операції');return;}
  const {error}=await sb.rpc('nikcar_confirm_point_payment',{p_payment:id,p_bank_reference:bankRef.trim()});
  if(error)throw error;toast('Платіж підтверджено, Points зараховано');await loadPoints();await load();return;
 }
 const {error}=await sb.rpc('nikcar_decide_payment',{p_id:id,p_confirm:a==='confirm-payment',p_note:''});if(error)throw error;toast(t(a==='confirm-payment'?'confirmed':'rejected'));await load();return;}
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
 if(a==='vehicle-check'){vehicleCheckOpen=vehicleCheckOpen===id?null:id;if(vehicleCheckOpen&&isOwner())await loadVehicleCheckAudit(id);render();return;}if(a==='registry-check'){if(!isOwner())return;const car=records.cars.find(x=>x.id===id);if(!car)throw Error('Автомобіль не знайдено');if(!car.plate&&!car.vin&&!car.registration_certificate)throw Error('У картці немає номера, VIN або техпаспорта');const entries=['insurance','fines'].map(check_type=>({car_id:id,check_type,status:'unavailable',source:'not_connected',details:{reason:'Official API provider is not configured',identifiers_present:{plate:!!car.plate,vin:!!car.vin,registration_certificate:!!car.registration_certificate}},checked_by:user.id}));const {error}=await sb.from('vehicle_registry_checks').insert(entries);if(error)throw error;await loadVehicleCheckAudit(id);render();toast('Офіційний API ще не підключено: результатів немає');return;}if(a==='ai-sync'){if(!isOwner())return;await load();await refreshAiMemory(true);toast('Оновлено');return;}if(a==='ai-forget'){if(!isOwner())return;if(!window.confirm('Видалити правило?'))return;const {error}=await sb.from('nikcar_ai_memory').delete().eq('id',id);if(error)throw error;await refreshAiMemory(true);return;}if(a==='ai-ask'){if(!isOwner())return;aiQuestion=btn.dataset.question||'';aiAnswer=nikcarAiRespond(aiQuestion);render();return;}
 if(a==='clear-new-car'){if(!isOwner())return;clearNewCarForm();return;}
 if(a==='edit-car'){if(!isOwner())return;carEditor=id;page='cars';render();const editor=document.getElementById('edit-car-form');editor?.scrollIntoView({behavior:'smooth',block:'center'});editor?.querySelector('[name=model]')?.focus({preventScroll:true});return;}
 if(a==='cancel-car-edit'){carEditor=null;render();return;}
 if(a==='cancel-days-off'){if(!isOwner())return;if(!window.confirm('Скасувати ці вихідні?'))return;const {error}=await sb.rpc('nikcar_cancel_days_off_v085',{p_id:id});if(error)throw error;toast('Вихідні скасовано');await load();return;}
 if(a==='driver-docs'){if(!isOwner())return;const driver=records.profiles.find(p=>p.id===id&&p.role==='driver');if(!driver)return;selectedDriverId=driver.id;page='documents';render();window.scrollTo(0,0);return;}if(a==='all-driver-docs'){if(!isOwner())return;selectedDriverId=null;page='documents';render();return;}
 if(a==='save-staff-role'){
  if(!isOwner())return;const sel=document.querySelector('select[data-staff-profile="'+id+'"]');const role=sel?.value;
  if(!['','administrator','accountant','mechanic'].includes(role))return;
  if(role){const {error}=await sb.from('nikcar_staff_assignments').upsert({profile_id:id,staff_role:role,assigned_by:user.id},{onConflict:'profile_id'});if(error)throw error;}
  else {const {error}=await sb.from('nikcar_staff_assignments').delete().eq('profile_id',id);if(error)throw error;}
  await refreshStaffAssignments();render();toast('Посаду збережено');return;
 }
 if(a==='driver-tab'){
  document.querySelectorAll('[data-action="driver-tab"]').forEach(tab=>{
   const selected=tab.dataset.id===id;
   tab.setAttribute('aria-pressed',String(selected));
   tab.classList.toggle('secondary',!selected);
  });
  filterDriverCards();return;
 }
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
 if(a==='view-damage'){const photo=records.rental_damage_photos.find(x=>x.id===id);if(!photo)return;const tab=window.open('about:blank','_blank');try{const {data,error}=await sb.storage.from('nikcar-photos').createSignedUrl(photo.photo_path,300);if(error)throw error;if(tab){tab.opener=null;tab.location.replace(data.signedUrl);}else toast('Дозвольте відкриття нового вікна');}catch(err){if(tab)tab.close();toast(err.message||String(err));}return;}if(a==='choose-car'){selectedCar=id;page='documents';render();window.scrollTo(0,0);return;}
 if(a==='submit-doc-choice'){if(!selectedCar||!hasLocalDocs(selectedCar)){toast(t('docsMissing'));return;}const existing=records.rental_requests.find(r=>r.driver_id===me.id&&(r.status==='pending'||(r.status==='approved'&&!r.returned_at)));if(existing){toast(existing.status==='pending'?'У вас вже є заявка на оренду. Дочекайтеся рішення власника.':'У вас вже є активна оренда.');page='requests';render();return;}const {error}=await sb.from('rental_requests').insert({car_id:selectedCar,driver_id:me.id});if(error){if(error.code==='23505'){toast('У вас вже є відкрита заявка. Оновлюємо список.');page='requests';await load();return;}toast(error.message);return;}toast(t('pending'));page='requests';forceMutationRefresh++;await load();return;}
 if(a==='open-doc'){const doc=records.driver_documents.find(d=>d.id===id);if(!doc)return;const tab=window.open('about:blank','_blank');try{const {data,error}=await sb.storage.from('nikcar-driver-docs').createSignedUrl(doc.object_path,60);if(error)throw error;if(tab){tab.opener=null;tab.location.replace(data.signedUrl);}else toast(lang==='uk'?'Дозвольте відкриття нового вікна для фото':'Allow pop-ups to view the photo');}catch(err){if(tab)tab.close();toast(err.message||String(err));}return;}
 if(a==='approve-request'||a==='reject-request'){return mutation(sb.from('rental_requests').update({status:a==='approve-request'?'approved':'rejected'}).eq('id',id).eq('status','pending').select(),t(a==='approve-request'?'approved':'rejected'));}
 if(a==='handover-rental'||a==='return-rental'){if(!isOwner())return;const form=btn.closest('.line')?.querySelector('.rental-odometer-form');if(!form)return;form.style.display='block';form.querySelector('[name=odometer]')?.focus();return;}
 if(a==='cancel-odometer-form'){const form=btn.closest('.rental-odometer-form');if(form)form.style.display='none';return;}
 if(a==='cancel-request'){return mutation(sb.from('rental_requests').update({status:'cancelled'}).eq('id',id).eq('status','pending').eq('driver_id',me.id).select(),t('cancelled'));}
 const r=records.sos_requests.find(x=>x.id===id);if(!r)return;
 if(a==='claim-sos'){return mutation(sb.from('sos_requests').update({status:'claimed',helper_id:me.id}).eq('id',id).eq('status','open').is('helper_id',null).select(),t('claimed'));}
 if(a==='release-sos'){return mutation(sb.from('sos_requests').update({status:'open',helper_id:null,resolved_at:null}).eq('id',id).eq('status','claimed').eq('helper_id',me.id).select(),t('open'));}
 if(a==='finish-sos'){return mutation(sb.from('sos_requests').update({status:'resolved',resolved_at:new Date().toISOString()}).eq('id',id).eq('status','claimed').eq('helper_id',me.id).select(),t('resolved'));}
 if(a==='cancel-sos'){return mutation(sb.from('sos_requests').update({status:'cancelled'}).eq('id',id).eq('status','open').eq('requester_id',me.id).select(),t('cancelled'));}
}
function closeNikcarPhotoViewer(){document.getElementById('nikcar-photo-viewer')?.remove();document.body.style.overflow='';}
document.addEventListener('keydown',evt=>{if(evt.key==='Escape')closeNikcarPhotoViewer();});
if('serviceWorker' in navigator)navigator.serviceWorker.addEventListener('message',evt=>{if(evt.data?.type==='nikcar-open-chat'){page='chat';render();}});
document.addEventListener('click',evt=>{
 const close=evt.target.closest('[data-close-photo-viewer]');
 if(close){closeNikcarPhotoViewer();return;}
 const img=evt.target.closest('img[data-photo-path],img.car-photo,img.driver-avatar');
 if(!img||!img.closest('#root')||!img.complete||!img.naturalWidth)return;
 const overlay=document.createElement('div');overlay.id='nikcar-photo-viewer';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','Перегляд фотографії');
 overlay.innerHTML='<button type="button" data-close-photo-viewer aria-label="Закрити фото" class="nikcar-photo-close">✕</button><img alt="">';
 const enlarged=overlay.querySelector('img');enlarged.src=img.currentSrc||img.src;enlarged.alt=img.alt||'Фото';overlay.addEventListener('click',e=>{if(e.target===overlay)closeNikcarPhotoViewer();});
 document.body.appendChild(overlay);document.body.style.overflow='hidden';overlay.querySelector('button').focus();
});
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
 if(f.id==='nikcar-contract-tenant'||f.id==='nikcar-contract-car'){
  nikcarContractSignatures.owner=null;nikcarContractSignatures.tenant=null;
  for(const role of ['owner','tenant']){const status=document.getElementById('nikcar-sign-'+role+'-status');if(status)status.textContent='Не підписано';}
  if(f.id==='nikcar-contract-tenant')nikcarFillTenant();
  return;
 }
 if(f.matches('input[type="file"][data-car-avatar]')){
  const file=f.files?.[0],carId=f.dataset.carAvatar;
  if(!file||!isOwner())return;
  if(isOffline()){toast(offlineMessage());return;}
  try{
   f.disabled=true;
   const path=await uploadFleetPhoto(file,'cars/'+carId+'/'+Date.now()+'.'+photoExt(file));
   const {error}=await sb.from('cars').update({photo_path:path}).eq('id',carId);
   if(error)throw error;
   const car=records.cars.find(c=>c.id===carId);if(car)car.photo_path=path;
   render();toast('Фото автомобіля оновлено');
  }catch(err){toast('Помилка оновлення фото: '+(err.message||err));}finally{f.disabled=false;}
  return;
 }
 if(f.matches('[data-notify-setting]')){const key=f.dataset.notifySetting;if(!Object.prototype.hasOwnProperty.call(notificationDefaults,key))return;const st=notificationState();st.settings[key]=f.checked;saveNotificationState(st);render();return;}
 if(f.id==='document-car'){selectedCar=f.value||null;render();return;}
 if(!f.matches('input[type="file"][data-doc-kind]'))return;
 const file=f.files?.[0],kind=f.dataset.docKind,car=f.dataset.car||null;
 if(!file||docBusy)return;
 if(isOffline()){toast(offlineMessage());return;}
 if(!me||me.role!=='driver'||!canApply()){toast(t('notApproved'));return;}
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>6291456||file.size===0){toast(t('docLimit'));return;}
 if(kind.startsWith('rental_contract')&&!car){toast(t('selectFirst'));return;}
 const ext=file.type==='image/png'?'png':file.type==='image/webp'?'webp':'jpg';
 const fileId=crypto.randomUUID();
 const authUserId=user.id,driverProfileId=me.id;
 const path=`${authUserId}/${kind}/${kind.startsWith('rental_contract')?car+'/':''}${fileId}.${ext}`;
 let uploaded=false;
 docBusy=true; f.disabled=true;
 try{
   const {error:uploadError}=await sb.storage.from('nikcar-driver-docs').upload(path,file,{cacheControl:'0',upsert:false,contentType:file.type});
   if(uploadError)throw uploadError;
   uploaded=true;
   if(isOffline())throw new Error(offlineMessage());
   if(user?.id!==authUserId||me?.id!==driverProfileId)throw new Error(lang==='uk'?'Акаунт змінився під час завантаження. Повторіть спробу.':'Account changed during upload. Please try again.');
   const old=docFor(kind,driverProfileId,kind.startsWith('rental_contract')?car:null);
   const query=old?sb.from('driver_documents').update({object_path:path}).eq('id',old.id):sb.from('driver_documents').insert({driver_id:driverProfileId,car_id:kind.startsWith('rental_contract')?car:null,kind,object_path:path});
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
document.addEventListener('change',evt=>{const side=evt.target.id==='tech-passport-photo'?'front':evt.target.id==='tech-passport-back-photo'?'back':null;if(!side)return;const file=evt.target.files?.[0];if(!file)return;if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024){toast('Фото техпаспорта: JPG/PNG/WebP до 5 МБ');evt.target.value='';return;}pendingPassportPhotos[side]=file;updatePassportAttachments();void readTechPassport(file);});
function filterFleetRows(){
 const apply=(selector,searchId,carId,kindId,emptyId,kindAttr)=>{
  const search=(document.getElementById(searchId)?.value||'').toLocaleLowerCase().trim();
  const car=document.getElementById(carId)?.value||'';
  const kind=document.getElementById(kindId)?.value||'';
  let visible=0;
  document.querySelectorAll(selector).forEach(row=>{
   const show=(!search||(row.dataset[kindAttr==='kind'?'fileSearch':'serviceSearch']||'').includes(search))&&(!car||row.dataset.carId===car)&&(!kind||row.dataset[kindAttr==='kind'?'kind':'completed']===kind);
   row.hidden=!show;if(show)visible++;
  });
  const empty=document.getElementById(emptyId);if(empty)empty.hidden=visible!==0;
 };
 apply('[data-service-row]','service-search','service-car-filter','service-state-filter','service-filter-empty','completed');
 apply('[data-fleet-file-row]','fleet-file-search','fleet-file-car-filter','fleet-file-kind-filter','fleet-file-filter-empty','kind');
}
document.addEventListener('input',evt=>{if(['service-search','fleet-file-search'].includes(evt.target.id))filterFleetRows();});
document.addEventListener('change',evt=>{if(['service-car-filter','service-state-filter','fleet-file-car-filter','fleet-file-kind-filter'].includes(evt.target.id))filterFleetRows();});
document.addEventListener('input',evt=>{const form=evt.target.closest?.('form');if(form)form.dataset.dirty='1';if(form?.id==='new-car')captureNewCarDraft();if(evt.target.id==='driver-filter')filterDriverCards()});
document.addEventListener('change',evt=>{const form=evt.target.closest?.('form');if(form)form.dataset.dirty='1';if(evt.target.matches('select[data-action="language"]')){lang='uk';localStorage.setItem('nikcar-lang','uk');render();}});
document.addEventListener('submit',async evt=>{const form=evt.target;const formId=form.getAttribute?.('id')||form.id;if(formId==='nikcar-contract-owner'){evt.preventDefault();if(!isOwner())return;const f=new FormData(form);const tax=String(f.get('owner_tax')||'').trim();if(tax&&!/^\d{10}$/.test(tax)){toast('РНОКПП має містити 10 цифр');return}localStorage.setItem('nikcar-contract-owner-v1',JSON.stringify({name:String(f.get('owner_name')||'').trim(),tax,doc:String(f.get('owner_doc')||'').trim(),address:String(f.get('owner_address')||'').trim(),phone:String(f.get('owner_phone')||'').trim()}));toast('Реквізити збережено на цьому пристрої');return}if(!form.matches('[data-sto-update]')&&!['nikcar-sto-create','auth-form','new-car','edit-car-form','import-existing-rental','announcement-form','chat-send','sos-create','profile-update','cash-payment-form','repair-create','repair-add-part','new-password-form','service-event','fleet-inspection-form','fleet-file-form','fleet-damage-ai-form','nikcar-ai-question','tracking-asset-form','api-key-create-form','point-post-form','fleet-fine-form','fuel-price-form'].includes(formId)&&!form.matches('.rental-odometer-form'))return;evt.preventDefault();if(form.dataset.submitting==='1')return;form.dataset.submitting='1';const submitBtn=form.querySelector('button[type="submit"]');if(submitBtn)submitBtn.disabled=true;const f=new FormData(form);try{
 if(isOffline())throw new Error(offlineMessage());
 if(form.matches('.rental-odometer-form')){if(!isOwner())throw Error('Доступ лише власнику');const request=records.rental_requests.find(r=>r.id===form.dataset.request);if(!request||request.status!=='approved')throw Error('Заявка вже змінила статус. Оновіть сторінку.');const handing=form.dataset.mode==='handover';if(handing&&request.handed_over_at)throw Error('Авто вже видано');if(!handing&&(!request.handed_over_at||request.returned_at))throw Error('Авто вже повернуто або ще не видано');const raw=String(f.get('odometer')??'').trim().replace(/[\s\u00a0]/g,'');const odometer=Number(raw);if(raw===''||!Number.isSafeInteger(odometer)||odometer<0||odometer>3000000)throw Error('Пробіг має бути цілим числом від 0 до 3000000 км. Введено: '+raw);if(!handing&&odometer<Number(request.odometer_out_km))throw Error('Пробіг при поверненні не може бути меншим за пробіг при видачі');if(f.get('full_tank')!=='on')throw Error('Підтвердіть повний бак');const {error}=await sb.rpc(handing?'nikcar_handover_rental':'nikcar_return_rental',{p_request:request.id,p_odometer:odometer,p_full_tank:true,p_note:String(f.get('note')||'').slice(0,2000)});if(error)throw error;toast(handing?'Авто видано':'Авто повернуто');forceMutationRefresh++;await load();return;}
 if(formId==='nikcar-sto-create'||form.matches('[data-sto-update]')){
 if(form.matches('[data-sto-update]')){const {error}=await sb.from('nikcar_service_tickets').update({status:String(f.get('status')),mechanic_note:String(f.get('note')||'').trim(),mechanic_id:me.id,updated_at:new Date().toISOString()}).eq('id',form.dataset.stoUpdate);if(error)throw error;await load();return;}
 const car=String(f.get('car')),description=String(f.get('description')||'').trim();
 if(description.length<5)throw Error('Опишіть проблему детальніше');
 const {data,error}=await sb.from('nikcar_service_tickets').insert({car_id:car,driver_id:me.id,description}).select('id').single();if(error)throw error;
 const photo=f.get('photo');if(photo&&photo.size){if(!['image/jpeg','image/png','image/webp'].includes(photo.type)||photo.size>5242880)throw Error('Фото JPG/PNG/WebP до 5 МБ');const path=user.id+'/'+data.id+'/'+crypto.randomUUID()+'.'+photoExt(photo);const up=await sb.storage.from('nikcar-service').upload(path,photo,{contentType:photo.type});if(up.error)throw up.error;const saved=await sb.from('nikcar_service_photos').insert({ticket_id:data.id,storage_path:path,uploaded_by:me.id});if(saved.error)throw saved.error;}
 toast('Заявку СТО створено');await load();return;
 }
 if(formId==='auth-form'){const email=String(f.get('email')||'').trim().toLowerCase(),password=String(f.get('password')||'');lastAuthEmail=email;
  if(mode==='reset'){assertAuthEmailCooldown();const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:authRedirect});if(error)throw error;markAuthEmailSent();authNoticeIsError=false;authNotice=lang==='uk'?'Якщо адреса зареєстрована, лист для відновлення надіслано. Перевірте «Спам».':'If this address is registered, a recovery link has been sent. Check spam too.';render();return;}
  if(mode==='signup'){const repeated=String(f.get('confirm_password')||'');if(password.length<10||password.length>128)throw Error(lang==='uk'?'Пароль повинен містити 10–128 символів.':'Password must have 10–128 characters.');if(password!==repeated)throw Error(lang==='uk'?'Паролі не збігаються.':'Passwords do not match.');assertAuthEmailCooldown();const {data,error}=await sb.auth.signUp({email,password,options:{emailRedirectTo:authRedirect,data:{full_name:String(f.get('fullname')||'').trim()}}});if(error)throw error;markAuthEmailSent();authNoticeIsError=false;authNotice=data?.session?(lang==='uk'?'Обліковий запис створено.':'Account created.'):(lang==='uk'?'Якщо реєстрація можлива, ви отримаєте лист підтвердження. Перевірте «Спам».':'If registration is available, you will receive a confirmation email. Check spam too.');mode='signin';render();return;}
  if(mode==='signin'&&authMethod==='magic'){assertAuthEmailCooldown();const {error}=await sb.auth.signInWithOtp({email,options:{emailRedirectTo:authRedirect,shouldCreateUser:false}});if(error)throw error;markAuthEmailSent();authNoticeIsError=false;authNotice=lang==='uk'?'Якщо акаунт існує, лист для входу надіслано. Перевірте пошту.':'If the account exists, a sign-in email has been sent. Check your inbox.';render();return;}
  const {error}=await sb.auth.signInWithPassword({email,password});if(error)throw error;return;}
 if(formId==='new-password-form'){
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
 if(formId==='point-post-form'){
 if(!isOwner())return;
 const driver=String(f.get('driver')),kind=String(f.get('kind')),amount=Number(f.get('amount')||0),liters=Number(f.get('liters')||0),reference=String(f.get('reference')||'').trim(),notes=String(f.get('notes')||'');
 if(!records.profiles.some(p=>p.id===driver&&p.role==='driver'))throw Error('Виберіть водія');
 if(!window.confirm('Підтвердити '+kind+' для '+name(driver)+'? Перевірте платіж або кількість літрів.'))return;
 const {error}=await sb.rpc('point_post',{p_driver:driver,p_kind:kind,p_amount:amount,p_reference:reference,p_notes:notes,p_liters:kind==='fuel'?liters:null});
 if(error)throw error;form.reset();await loadPoints();toast('Операцію записано');return;
}
if(formId==='api-key-create-form'){
 if(!isOwner())return;
 const name=String(f.get('name')||'').trim(),days=Number(f.get('days'));
 const data=await apiCall('create','POST',{name,days});
 apiNewSecret=data.key;apiKeyList=null;await refreshApiKeys();toast('Ключ створено. Збережіть секрет зараз.');return;
}
if(formId==='fuel-price-form'){
  if(!isOwner())return;
  const price=Number(f.get('price'));if(!Number.isFinite(price)||price<=0||price>1000)throw Error('Невірна ціна за літр');
  const previous=Number(records.fleet_fuel_price?.[0]?.price_uah||0);
  const preview='Поточна ціна: '+(previous?money(previous):'не встановлена')+'\nНова ціна: '+money(price)+' / л\n10 л: '+money(price*10)+'\n25 л: '+money(price*25)+'\n50 л: '+money(price*50)+'\n100 л: '+money(price*100)+'\nЗастосувати нову ціну до розрахунку доступних літрів усіх Point Balance? Кількість Points залишається незмінною.';
  if(!window.confirm(preview))return;
  const {error}=await sb.from('fleet_fuel_price').upsert({id:true,price_uah:price},{onConflict:'id'});
  if(error)throw error;forceMutationRefresh++;await load();toast('Нову ціну дизеля збережено');return;
 }
 if(formId==='fleet-fine-form'){
  if(!isOwner())return;
  const violation=String(f.get('violation_at')||''),amount=Number(f.get('amount'));
  const car_id=String(f.get('car_id')||''),notice_number=String(f.get('notice_number')||'').trim();
  if(!records.cars.some(c=>c.id===car_id)||!notice_number||!Number.isFinite(Date.parse(violation))||!(amount>0))throw Error('Перевірте дані постанови');
  const {error}=await sb.from('fleet_fines').insert({car_id,notice_number,violation_at:new Date(violation).toISOString(),amount,notes:String(f.get('notes')||'').trim(),source:'manual'});
  if(error)throw error;
  form.reset();forceMutationRefresh++;await load();toast('Штраф зареєстровано. Водія визначено за періодом оренди.');return;
 }
 if(formId==='cash-payment-form'){if(!canApply())return;const rentalId=String(f.get('rental')||'');if(!records.rental_requests.some(r=>r.id===rentalId&&r.driver_id===me.id&&r.status==='approved'))throw Error(t('noApprovedRental'));const amount=Number(f.get('amount'));if(!(amount>0&&amount<=1000000))throw Error(t('amount'));const purpose=String(f.get('purpose')||'');if(!['rent','fuel_points','fine'].includes(purpose))throw Error('Оберіть призначення платежу');if(!window.confirm(t('paymentHint')))return;const note='['+purpose+'] '+String(f.get('note')||'').trim();await mutation(sb.from('payment_claims').insert({driver_id:me.id,rental_request_id:rentalId,method:f.get('method'),amount,driver_note:note.trim()}),t('declared'));return;}
 if(formId==='tracking-asset-form'){if(!isOwner())return;const title=String(f.get('title')||'').trim();if(title.length<2)throw Error('Вкажіть назву техніки');const {error}=await sb.from('fleet_tracking_assets').insert({title,category:String(f.get('category')||'other'),car_id:String(f.get('car_id')||'')||null,provider:String(f.get('provider')||'').trim()||null,device_identifier:String(f.get('device_identifier')||'').trim()||null,sim_phone:String(f.get('sim_phone')||'').trim()||null,note:String(f.get('note')||'').trim()||null});if(error)throw error;form.reset();forceMutationRefresh++;await load();toast('Техніку додано до реєстру');return;}
 if(formId==='nikcar-ai-memory-form'){if(!isOwner())return;const note=String(f.get('note')||'').trim();if(note.length<3||note.length>1000)throw Error('Правило: 3–1000 символів');const {error}=await sb.from('nikcar_ai_memory').insert({note,created_by:user.id});if(error)throw error;await refreshAiMemory(true);toast('Збережено');return;}if(formId==='nikcar-ai-question'){if(!isOwner())return;aiQuestion=String(f.get('question')||'').trim();aiAnswer=nikcarAiRespond(aiQuestion);render();return;}
 if(formId==='fleet-damage-ai-form'){
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
 if(formId==='fleet-inspection-form'){
  if(!isOwner())return;
  const states=['ok','attention','critical','unknown'],entry={car_id:String(f.get('car_id'))};
  for(const k of ['engine','brakes','tires','body']){entry[k]=String(f.get(k));if(!states.includes(entry[k]))throw Error('Некоректна оцінка стану');}
  const km=String(f.get('odometer_km')||'').trim();
  entry.odometer_km=km?Number(km):null;entry.notes=String(f.get('notes')||'').trim();
  const {error}=await sb.from('fleet_inspections').insert(entry);if(error)throw error;
  ownerUiDrafts.delete(user.id+':fleet-inspection-form');form.reset();await load();return;
 }
 if(formId==='fleet-file-form'){
  if(!isOwner())return;
  const file=f.get('file'),kind=String(f.get('kind')),car_id=String(f.get('car_id')),title=String(f.get('title')||'').trim();
  const types={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','application/pdf':'pdf'};
  if(!file||!types[file.type]||!file.size||file.size>15728640)throw Error('Дозволені JPG, PNG, WebP, PDF до 15 МБ');
  if(['damage_photo','inspection_photo'].includes(kind)&&file.type==='application/pdf')throw Error('Для фотоогляду завантажте JPG, PNG або WebP, а не PDF');
  if(!['contract','handover_act','return_act','damage_photo','inspection_photo','oscpv','casco','registration','service_invoice','other'].includes(kind))throw Error('Некоректний тип документа');
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
 if(formId==='service-event'){
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
 if(formId==='repair-create'){if(!isOwner())return;const title=String(f.get('title')||'').trim(),vin=String(f.get('vin')||'').trim().toUpperCase(),labor=Number(f.get('labor'));if(vin&&!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin))throw Error(t('repairVIN'));const {data,error}=await sb.from('repair_jobs').insert({car_id:String(f.get('car')),title,vin:vin||null,symptoms:String(f.get('symptoms')||'').trim(),labor_cost:labor,created_by:me.id}).select('id').single();if(error)throw error;currentRepair=data.id;toast(t('repairCreate'));await load();return;}
 if(formId==='repair-add-part'){if(!isOwner()||!currentRepair)return;const job=records.repair_jobs.find(j=>j.id===currentRepair);if(!job||job.status!=='draft')return;const price=Number(f.get('unit_price')),qty=Number(f.get('qty'));if(!Number.isFinite(price)||price<0||!Number.isFinite(qty)||qty<=0)throw Error(t('repairPrice'));await mutation(sb.from('repair_parts').insert({repair_id:currentRepair,item_name:String(f.get('item')||'').trim(),article:String(f.get('article')||'').trim(),supplier:String(f.get('supplier')||'').trim(),supplier_url:String(f.get('url')||'').trim(),quantity:qty,unit_price:price}));return;}
 if(formId==='announcement-form'){
  if(!isOwner())return;await mutation(sb.from('announcements').insert({author_id:me.id,title_uk:String(f.get('title_uk')||'').trim(),title_en:String(f.get('title_en')||'').trim(),body_uk:String(f.get('body_uk')||'').trim(),body_en:String(f.get('body_en')||'').trim(),pinned:f.get('pinned')==='on'}));return;
 }
 if(formId==='import-existing-rental'){
  if(!isOwner())throw Error('Доступ лише власнику');
  const carId=String(f.get('car')||''),driverId=String(f.get('driver')||'');
  const raw=String(f.get('odometer')??'').trim(),odometer=Number(raw),debt=Number(f.get('opening_debt'));
  if(!/^\d+$/.test(raw)||!Number.isSafeInteger(odometer)||odometer<0||odometer>3000000)throw Error('Вкажіть коректний пробіг');
  if(!Number.isFinite(debt)||debt<0||debt>10000000||Math.abs(Math.round(debt*100)-debt*100)>0.000001)throw Error('Вкажіть борг у гривнях з точністю до копійок');
  const car=records.cars.find(c=>c.id===carId),driver=records.profiles.find(p=>p.id===driverId);
  if(!car||!driver)throw Error('Оберіть авто і водія');
  if(!window.confirm('Перенести '+car.model+' · '+car.plate+' для '+(driver.full_name||'водія')+'? Старий борг: '+money(debt)+'. Нарахування почнуться сьогодні.'))return;
  const {error}=await sb.rpc('nikcar_import_existing_rental',{p_car:carId,p_driver:driverId,p_odometer:odometer,p_opening_debt:debt});
  if(error)throw error;
  toast('Оренду перенесено. Нові нарахування почалися сьогодні.');
  forceMutationRefresh++;await load();return;
 }
 if(formId==='edit-car-form'){
  if(!isOwner())return;if(requestManualCarYear(form))return;const carId=String(f.get('car_id')||'');const newRate=Number(f.get('rate'));if(!Number.isFinite(newRate)||newRate<1)throw Error('Вкажіть коректну ціну оренди за тиждень');if(!records.cars.some(c=>c.id===carId))throw Error('Автомобіль не знайдено');
  const carFile=form.querySelector('[name=car_photo]')?.files?.[0];const passportFile=pendingPassportPhotos.front;const passportBackFile=pendingPassportPhotos.back;const photoPath=carFile?await uploadFleetPhoto(carFile,'cars/'+carId+'/'+Date.now()+'.'+photoExt(carFile)):null;const saved=await mutation(sb.from('cars').update({...(photoPath?{photo_path:photoPath}:{}),plate:String(f.get('plate')||'').trim().toUpperCase(),model:String(f.get('model')||'').trim(),year:f.get('year')?Number(f.get('year')):null,weekly_rate:Number(f.get('rate')),daily_rate:Number(f.get('rate'))/7,vin:String(f.get('vin')||'').trim().toUpperCase()||null,registration_certificate:String(f.get('registration_certificate')||'').trim().toUpperCase()||null}).eq('id',carId).select('id'));if(saved){carEditor=null;render();toast('Дані авто збережено. Нова ціна діє з наступного дня.');}return;
 }
 if(formId==='new-car'){if(requestManualCarYear(form))return;const carFile=form.querySelector('[name=car_photo]')?.files?.[0];const passportFile=pendingPassportPhotos.front;const passportBackFile=pendingPassportPhotos.back;if(carFile&&(!['image/jpeg','image/png','image/webp'].includes(carFile.type)||carFile.size>5*1024*1024))throw Error('Фото: JPG/PNG/WebP, до 5 МБ');const {data:created,error}=await sb.from('cars').insert({plate:String(f.get('plate')).trim().toUpperCase(),model:String(f.get('model')).trim(),year:f.get('year')?Number(f.get('year')):null,weekly_rate:Number(f.get('rate')),daily_rate:Number(f.get('rate'))/7,vin:String(f.get('vin')||'').trim().toUpperCase()||null,registration_certificate:String(f.get('registration_certificate')||'').trim().toUpperCase()||null}).select('id').single();if(error){toast(error.message);return;}if(carFile||passportFile||passportBackFile){try{const changes={};if(carFile)changes.photo_path=await uploadFleetPhotoWithRetry(carFile,'cars/'+created.id+'/main.'+photoExt(carFile));if(passportFile)changes.registration_photo_path=await uploadFleetPhotoWithRetry(passportFile,'cars/'+created.id+'/registration-front.'+photoExt(passportFile));if(passportBackFile)changes.registration_photo_back_path=await uploadFleetPhotoWithRetry(passportBackFile,'cars/'+created.id+'/registration-back.'+photoExt(passportBackFile));const saved=await sb.from('cars').update(changes).eq('id',created.id);if(saved.error)throw saved.error;}catch(err){toast('Авто додано, але фото не завантажено: '+err.message);}}/* Clear draft BEFORE load/render: the old mutation() refreshed the page and re-captured saved fields. */clearNewCarForm();const ocrStatus=document.getElementById('tech-passport-status');if(ocrStatus)ocrStatus.textContent='Автомобіль збережено. Форма готова до наступного додавання.';toast(lang==='uk'?'Автомобіль додано':'Car added');forceMutationRefresh++;await load();return;}
 if(formId==='chat-send'){const body=String(f.get('text')||'').trim();if(!body)return;const {data:sent,error:sendError}=await sb.from('chat_messages').insert({sender_id:me.id,body}).select('id').single();if(sendError)throw sendError;try{const {error:pushError}=await sb.functions.invoke('nikcar-chat-push',{body:{message_id:sent.id}});if(pushError)console.warn('Chat push unavailable',pushError);}catch(pushError){console.warn('Chat push unavailable',pushError);}forceMutationRefresh++;await load();return;}
 if(formId==='sos-create'){await mutation(sb.from('sos_requests').insert({requester_id:me.id,category:f.get('category'),note:String(f.get('note')||'').trim(),location_text:String(f.get('location')||'').trim()}));return;}
 if(form.classList.contains('damage-upload-form')){const rentalId=form.dataset.rental;const rental=records.rental_requests.find(x=>x.id===rentalId);if(!rental||rental.status!=='approved'||rental.returned_at||(!isOwner()&&rental.driver_id!==me.id))throw Error('Немає доступу до цього огляду');const file=form.querySelector('[name=damage_photo]')?.files?.[0];const description=String(f.get('damage_description')||'').trim();if(!file||!description)throw Error('Додайте фото та опис');const path='damages/'+rentalId+'/'+crypto.randomUUID()+'.'+photoExt(file);await uploadFleetPhoto(file,path);const {error}=await sb.from('rental_damage_photos').insert({rental_request_id:rentalId,car_id:rental.car_id,driver_id:rental.driver_id,photo_path:path,description});if(error)throw error;toast('Фото дефекту збережено');await load();return;}if(formId==='profile-update'){const file=form.querySelector('[name=avatar_photo]')?.files?.[0];let avatar_path=me.avatar_path;if(file)avatar_path=await uploadFleetPhoto(file,'avatars/'+me.id+'/profile.'+photoExt(file));const update={full_name:String(f.get('fullname')||'').trim(),phone:String(f.get('phone')||'').trim()};if(file)update.avatar_path=avatar_path;await mutation(sb.from('profiles').update(update).eq('id',me.id));return;}
 }catch(err){if(formId==='auth-form'||formId==='new-password-form'){const op=formId==='auth-form'?(mode==='reset'?'reset':mode==='signup'?'signup':mode==='signin'&&authMethod==='magic'?'magic':''):'';authNotice=authErrorMessage(err,op);authNoticeIsError=true;if(isOffline())toast(authNotice);else render();}else toast(err.message||err);}finally{if(form.isConnected){form.dataset.submitting='0';if(submitBtn)submitBtn.disabled=false;}}});
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
 for(const table of ['chat_messages','sos_requests','rental_requests','announcements','payment_claims','repair_jobs','driver_days_off','days_off_notifications'])
  sb.channel(`nikcar-${table}`).on('postgres_changes',{event:'*',schema:'public',table},()=>{if(user&&!recoveryMode)void load({preserveDraft:true});}).subscribe();
 }catch(err){root.innerHTML=`<div class="auth-layout"><div class="auth-box"><h1>${t('systemError')}</h1><p>${e(err.message||err)}</p></div></div>`;}})();
// v0.85: Submit only through authenticated RPC; never write directly to protected tables.
document.addEventListener('submit',async evt=>{
 const form=evt.target;if(form?.id==='weekly-rent-form'){evt.preventDefault();await calculateWeeklyRent(form);return;}if(form?.id!=='days-off-form')return;
 evt.preventDefault();if(!isOwner()||!sb)return;
 const data=new FormData(form),from=String(data.get('from')||''),to=String(data.get('to')||'');
 if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(from)||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(to)||to<from){toast('Перевірте дати');return;}
 const button=form.querySelector('button[type=submit]');button.disabled=true;
 try{const {error}=await sb.rpc('nikcar_approve_days_off_v085',{p_car_id:String(data.get('car')),p_from:from,p_to:to,p_reason:String(data.get('reason')||'')});if(error)throw error;toast('Вихідні підтверджено');form.reset();await load();}
 catch(err){toast('Не збережено: '+(err.message||'сервер недоступний'));}
 finally{button.disabled=false;}
});
