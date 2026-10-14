package views.html
package auth

import controllers.routes
import play.api.data.Form

import lila.api.Context
import lila.app.templating.Environment._
import lila.app.ui.ScalatagsTemplate._

object login {

  val twoFactorHelp = span(dataIcon := Icons.mobile)(
    "Open the two-factor authentication app on your device to view your authentication code and verify your identity.",
  )

  def apply(form: Form[_], referrer: Option[String])(implicit ctx: Context) =
    views.html.base.layout(
      title = trans.signIn.txt(),
      moreCss = cssTag("user.auth"),
      moreJs = jsTag("user.login"),
      canonicalPath = lila.common.CanonicalPath(routes.Auth.login).some,
      withHrefLangs = lila.i18n.LangList.All.some,
    ) {
      main(cls := "auth auth-login box box-pad")(
        h1(trans.signIn()),
        postForm(
          cls := "form3",
          action := s"${routes.Auth.authenticate}${referrer.?? { ref =>
              s"?referrer=${urlencode(ref)}"
            }}",
        )(
          div(cls := "one-factor")(
            auth.bits.formFields(form("username"), form("password"), none, register = false),
            form3.globalError(form),
            form3.submit(trans.signIn(), icon = none),
          ),
          div(cls := "two-factor none")(
            form3.group(form("token"), raw("Authentication code"), help = Some(twoFactorHelp))(
              form3.input(_)(autocomplete := "one-time-code", pattern := "[0-9]{6}"),
            ),
            p(cls := "error none")("Invalid code."),
            form3.submit(trans.signIn(), icon = none),
          ),
        ),
        div(cls := "alternative")(
          a(href := langHref(routes.Auth.signup))(trans.signUp()),
        ),
      )
    }
}
