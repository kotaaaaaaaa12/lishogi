package lila.security

import scala.concurrent.duration._

import play.api.data._
import play.api.mvc.Request
import play.api.mvc.RequestHeader

import lila.common.HTTPRequest
import lila.common.IpAddress
import lila.common.config.NetConfig
import lila.memo.RateLimit
import lila.user.PasswordHasher
import lila.user.User

final class Signup(
    store: Store,
    forms: DataForm,
    recaptcha: Recaptcha,
    authenticator: lila.user.Authenticator,
    userRepo: lila.user.UserRepo,
    netConfig: NetConfig,
)(implicit ec: scala.concurrent.ExecutionContext) {

  def website(
      blind: Boolean,
  )(implicit req: Request[_], formBinding: FormBinding): Fu[Signup.Result] =
    forms.signup.website
      .bindFromRequest()
      .fold[Fu[Signup.Result]](
        err => fuccess(Signup.Bad(err)),
        data =>
          recaptcha.verify(~data.recaptchaResponse, req).flatMap {
            case false => fuccess(Signup.Bad(forms.signup.website fill data))
            case true =>
              signupRateLimit(data.username, if (data.recaptchaResponse.isDefined) 1 else 2) {
                createAccount(data.username, data.password, blind, data.fingerPrint)
              }
          },
      )

  def mobile(implicit req: Request[_], formBinding: FormBinding): Fu[Signup.Result] =
    forms.signup.mobile
      .bindFromRequest()
      .fold[Fu[Signup.Result]](
        err => fuccess(Signup.Bad(err)),
        data =>
          signupRateLimit(data.username, cost = 2) {
            createAccount(data.username, data.password, blind = false, fingerPrint = none)
          },
      )

  private def createAccount(
      username: String,
      password: String,
      blind: Boolean,
      fingerPrint: Option[FingerPrint],
  ): Fu[Signup.Result] = {
    lila.mon.user.register.count.increment()
    val passwordHash = authenticator passEnc User.ClearPassword(password)
    userRepo
      .createWithoutEmail(username, passwordHash, blind)
      .orFail(s"No user could be created for $username")
      .addEffect { user =>
        lila.log("auth").info(s"${user.username} signup without email fp: ${fingerPrint.??(_.value)}")
      }
      .flatMap { user =>
        store.deletePreviousSessions(user) inject Signup.AllSet(user)
      }
  }

  private def HasherRateLimit =
    PasswordHasher.rateLimit[Signup.Result](enforce = netConfig.rateLimit) _

  private lazy val signupRateLimitPerIP = RateLimit.composite[IpAddress](
    key = "account.create.ip",
    enforce = netConfig.rateLimit.value,
  )(
    ("fast", 10, 10.minutes),
    ("slow", 150, 1 day),
  )

  private val rateLimitDefault = fuccess(Signup.RateLimited)

  private def signupRateLimit(username: String, cost: Int)(
      f: => Fu[Signup.Result],
  )(implicit req: RequestHeader): Fu[Signup.Result] =
    HasherRateLimit(username, req) { _ =>
      signupRateLimitPerIP(HTTPRequest lastRemoteAddress req, cost = cost)(f)(rateLimitDefault)
    }(rateLimitDefault)
}

object Signup {
  sealed trait Result
  case class Bad(err: Form[_]) extends Result
  case object RateLimited extends Result
  case class AllSet(user: User) extends Result
}
