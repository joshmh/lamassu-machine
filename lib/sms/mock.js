export function phoneCode () {
  return new Promise(resolve => setTimeout(() => resolve('123456'), 1000))
}
